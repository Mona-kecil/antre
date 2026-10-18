import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const secret = "test-secret";
const now = Date.parse("2026-10-18T04:00:00Z");

beforeEach(() => {
  vi.stubEnv("ANTRE_SECRET", secret);
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("syncs paginated conversations, lists unanswered replies, publishes an answer, and hides/unhides without duplicate rows", async () => {
  const t = convexTest(schema, modules);
  const postId = await t.run(async (ctx) => {
    await ctx.db.insert("account", {
      threadsUserId: "owner",
      username: "owner",
      accessToken: "test-token",
      tokenExpiresAt: now + 86_400_000,
      needsReconnect: false,
    });
    await ctx.db.insert("posts", {
      parts: [{ text: "Old root" }],
      publishedIds: ["old"],
      source: "threads",
      status: {
        kind: "published",
        at: now - 8 * 86_400_000,
        permalink: "https://threads.net/old",
      },
    });
    await ctx.db.insert("posts", {
      parts: [{ text: "Draft" }],
      publishedIds: [],
      source: "agent",
      status: { kind: "draft" },
    });
    return ctx.db.insert("posts", {
      parts: [{ text: "Root text" }, { text: "Self-thread part" }],
      publishedIds: ["root", "self"],
      source: "agent",
      status: {
        kind: "published",
        at: now - 60_000,
        permalink: "https://threads.net/root",
      },
    });
  });
  const calls: { path: string; method: string; params: URLSearchParams }[] = [];
  let statusChecks = 0;
  let hidden = false;
  let published = false;
  let failPermalink = false;
  let replyTarget = "alice";
  let replyText = "Thanks Alice";
  let publishedId = "answer";
  const item = (id: string, parent: string, at: number, extra = {}) => ({
    id,
    text: `${id} text`,
    username: id,
    timestamp: new Date(at).toISOString(),
    replied_to: { id: parent },
    is_reply_owned_by_me: false,
    permalink: `https://threads.net/${id}`,
    ...extra,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL, init: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname.slice("/v1.0/".length);
      const method = init.method ?? "GET";
      const params =
        method === "GET"
          ? url.searchParams
          : new URLSearchParams(String(init.body));
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer test-token",
      );
      calls.push({ path, method, params });
      if (path === "me/threads")
        return Response.json({
          data: [
            {
              id: "root",
              text: "Root text",
              timestamp: new Date(now - 60_000).toISOString(),
              permalink: "https://threads.net/root",
            },
            {
              id: "old",
              text: "Old root",
              timestamp: new Date(now - 8 * 86_400_000).toISOString(),
              permalink: "https://threads.net/old",
            },
          ],
        });
      if (path.endsWith("/insights") || path === "owner/threads_insights")
        return Response.json({ data: [] });
      if (path === "root/conversation") {
        expect(params.get("fields")).toBe(
          "id,text,username,timestamp,permalink,replied_to,is_reply_owned_by_me,hide_status",
        );
        if (params.get("after") === "page2")
          return Response.json({
            data: [
              item("bob", "alice", now - 1_000),
              item("hidden", "root", now - 500, { hide_status: "HIDDEN" }),
              ...(published
                ? [
                    item("answer", "alice", now, {
                      username: "owner",
                      is_reply_owned_by_me: true,
                    }),
                  ]
                : []),
            ],
          });
        return Response.json({
          data: [
            item("alice", "root", now - 3_000),
            // Threads may omit optional fields even on a known self-thread part.
            {
              id: "self",
              text: "Self-thread part",
              timestamp: new Date(now - 2_000).toISOString(),
              replied_to: { id: "root" },
            },
          ],
          paging: {
            next: "https://graph.threads.net/v1.0/root/conversation?after=page2",
          },
        });
      }
      if (path === "owner/threads" && method === "POST") {
        expect(Object.fromEntries(params)).toEqual({
          media_type: "TEXT",
          text: replyText,
          reply_to_id: replyTarget,
        });
        return Response.json({ id: "container" });
      }
      if (path === "container") {
        expect(method).toBe("GET");
        expect(params.get("fields")).toBe("status,error_message");
        statusChecks++;
        return Response.json({
          status: statusChecks === 1 ? "IN_PROGRESS" : "FINISHED",
        });
      }
      if (path === "owner/threads_publish") {
        expect(method).toBe("POST");
        expect(params.get("creation_id")).toBe("container");
        expect(statusChecks).toBe(2);
        published = true;
        return Response.json({ id: publishedId });
      }
      if (path === publishedId) {
        expect(params.get("fields")).toBe("permalink");
        if (failPermalink) throw new Error("Permalink lookup failed");
        return Response.json({ permalink: "https://threads.net/answer" });
      }
      if (path === "bob/manage_reply") {
        expect(method).toBe("POST");
        hidden = params.get("hide") === "true";
        return Response.json({ success: true });
      }
      throw new Error(`Unexpected Threads request ${method} ${path}`);
    }),
  );

  expect(await t.query(api.replies.list, { secret })).toEqual({
    syncedAt: null,
    replies: [],
  });
  await expect(t.query(api.replies.list, { secret: "wrong" })).rejects.toThrow(
    "Unauthorized",
  );
  expect(await t.action(api.sync.now, { secret })).toEqual({
    imported: 0,
    removed: 0,
    metricsUpdated: 2,
    replies: 4,
    error: null,
  });
  const list = await t.query(api.replies.list, { secret });
  expect(list.syncedAt).toBe(new Date(now).toISOString());
  expect(list.replies).toEqual([
    {
      replyId: "bob",
      username: "bob",
      text: "bob text",
      at: new Date(now - 1_000).toISOString(),
      permalink: "https://threads.net/bob",
      hidden: false,
      parentText: "alice text",
      postId,
      postText: "Root text",
    },
    {
      replyId: "alice",
      username: "alice",
      text: "alice text",
      at: new Date(now - 3_000).toISOString(),
      permalink: "https://threads.net/alice",
      hidden: false,
      parentText: "Root text",
      postId,
      postText: "Root text",
    },
  ]);
  expect(
    (await t.query(api.replies.list, { secret, postId, limit: 1 })).replies.map(
      (r) => r.replyId,
    ),
  ).toEqual(["bob"]);
  expect(
    (await t.query(api.replies.list, { secret, unanswered: false })).replies,
  ).toHaveLength(4);
  for (const text of [" ", "x".repeat(501)])
    await expect(
      t.action(api.replies.reply, { secret, replyId: "alice", text }),
    ).rejects.toThrow("1–500");
  await expect(
    t.action(api.replies.reply, {
      secret: "wrong",
      replyId: "alice",
      text: "Thanks Alice",
    }),
  ).rejects.toThrow("Unauthorized");
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  expect(
    await t.action(api.replies.reply, {
      secret,
      replyId: "alice",
      text: "Thanks Alice",
    }),
  ).toEqual({ replyId: "answer", permalink: "https://threads.net/answer" });
  // This assertion must fail if the mine-replied exclusion is removed.
  expect(
    (await t.query(api.replies.list, { secret })).replies.map((r) => r.replyId),
  ).toEqual(["bob"]);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("replies")
        .withIndex("by_threadsId", (q) => q.eq("threadsId", "answer"))
        .unique(),
    ),
  ).toMatchObject({
    mine: true,
    repliedToId: "alice",
    postId,
    text: "Thanks Alice",
    permalink: "https://threads.net/answer",
  });
  expect(
    calls
      .filter((c) => c.method === "POST" || c.path === "container")
      .map((c) => `${c.method} ${c.path}`),
  ).toEqual([
    "POST owner/threads",
    "GET container",
    "GET container",
    "POST owner/threads_publish",
  ]);
  expect(
    await t.action(api.replies.hide, { secret, replyId: "bob", hide: true }),
  ).toEqual({ hidden: true });
  expect(hidden).toBe(true);
  expect((await t.query(api.replies.list, { secret })).replies).toEqual([]);
  expect(
    (
      await t.query(api.replies.list, { secret, unanswered: false })
    ).replies.find((r) => r.replyId === "bob")?.hidden,
  ).toBe(true);
  expect(await t.action(internal.replies.sync, {})).toEqual({
    replies: 5,
    error: null,
  });
  expect(await t.run((ctx) => ctx.db.query("replies").collect())).toHaveLength(
    5,
  );
  // Missing hide_status must preserve a hide recorded by the action.
  expect((await t.query(api.replies.list, { secret })).replies).toEqual([]);
  expect(
    await t.action(api.replies.hide, { secret, replyId: "bob", hide: false }),
  ).toEqual({ hidden: false });
  expect(hidden).toBe(false);
  expect(
    (await t.query(api.replies.list, { secret })).replies.map((r) => r.replyId),
  ).toEqual(["bob"]);

  // A failed optional permalink lookup must still record the published answer.
  failPermalink = true;
  statusChecks = 0;
  replyTarget = "bob";
  replyText = "Thanks Bob";
  publishedId = "answer-bob";
  expect(
    await t.action(api.replies.reply, {
      secret,
      replyId: "bob",
      text: "Thanks Bob",
    }),
  ).toEqual({ replyId: "answer-bob", permalink: null });
  expect((await t.query(api.replies.list, { secret })).replies).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("replies").collect())).toHaveLength(
    6,
  );
});

test("reply sync keeps partial progress, collects redacted errors, and leaves the last complete sync timestamp unchanged", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("account", {
      threadsUserId: "owner",
      username: "owner",
      accessToken: "test-token",
      tokenExpiresAt: now + 86_400_000,
      needsReconnect: false,
      repliesSyncedAt: now - 3_600_000,
    });
    for (const id of ["bad", "good"])
      await ctx.db.insert("posts", {
        parts: [{ text: id }],
        publishedIds: [id],
        source: "threads",
        status: {
          kind: "published",
          at: now,
          permalink: `https://threads.net/${id}`,
        },
      });
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL) => {
      if (new URL(input).pathname === "/v1.0/bad/conversation")
        return Response.json(
          { error: { message: "Permission denied test-token" } },
          { status: 400 },
        );
      return Response.json({
        data: [{ id: "new", timestamp: new Date(now).toISOString() }],
        paging: {
          cursors: { after: "repeat" },
          next: "https://graph.threads.net/v1.0/good/conversation?after=repeat",
        },
      });
    }),
  );
  const result = await t.action(internal.replies.sync, {});
  expect(result.replies).toBe(2);
  expect(result.error).toContain("Permission denied [redacted]");
  expect(result.error).toContain("Threads repeated a pagination cursor");
  expect(result.error).not.toContain("test-token");
  const list = await t.query(api.replies.list, { secret });
  expect(list.syncedAt).toBe(new Date(now - 3_600_000).toISOString());
  expect(list.replies).toHaveLength(1);
  expect(list.replies[0]).toMatchObject({
    username: "",
    text: "",
    permalink: null,
    parentText: null,
  });
});
