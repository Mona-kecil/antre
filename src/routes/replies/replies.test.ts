import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import schema from "../../../convex/schema";
import { actions, load } from "./+page.server";

const bridge = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  action: vi.fn(),
}));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: "test-secret" }),
}));
const modules = import.meta.glob([
  "../../../convex/**/*.ts",
  "!../../../convex/**/*.test.ts",
]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

test("owner reviews drafts, saves edits, sends only stored text, and discards through web actions", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  bridge.action.mockImplementation(t.action);
  await t.run(async (ctx) => {
    await ctx.db.insert("account", {
      threadsUserId: "owner",
      username: "owner",
      accessToken: "test-token",
      tokenExpiresAt: Date.now() + 86_400_000,
      needsReconnect: false,
    });
    const postId = await ctx.db.insert("posts", {
      parts: [{ text: "Root context" }],
      publishedIds: ["root"],
      source: "threads",
      status: {
        kind: "published",
        at: Date.now(),
        permalink: "https://threads.net/root",
      },
    });
    for (const threadsId of ["reader", "another"])
      await ctx.db.insert("replies", {
        threadsId,
        postId,
        text: "Question",
        username: threadsId,
        at: Date.now(),
        repliedToId: "root",
        mine: false,
        hidden: false,
      });
  });
  const fetch = vi.fn(async (input: URL, init: RequestInit) => {
    const path = new URL(input).pathname;
    if (path === "/v1.0/owner/threads") {
      expect(
        Object.fromEntries(new URLSearchParams(String(init.body))),
      ).toEqual({
        media_type: "TEXT",
        text: "Saved human edit",
        reply_to_id: "reader",
      });
      return Response.json({ id: "container" });
    }
    if (path === "/v1.0/container")
      return Response.json({ status: "FINISHED" });
    if (path === "/v1.0/owner/threads_publish")
      return Response.json({ id: "sent" });
    if (path === "/v1.0/sent")
      return Response.json({ permalink: "https://threads.net/sent" });
    throw new Error(`Unexpected Threads request ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  const page = (userId = "owner") =>
    load({ locals: { userId } } as Parameters<typeof load>[0]);
  const act = (operation: string, text?: string, userId = "owner") => {
    const body = new URLSearchParams({ operation, replyId: "reader" });
    if (text !== undefined) body.set("text", text);
    return actions.reply({
      locals: { userId },
      request: new Request("https://antre.example/replies?/reply", {
        method: "POST",
        body,
      }),
    } as Parameters<typeof actions.reply>[0]);
  };

  expect(await page()).toMatchObject({
    replies: [
      { draft: null, parentText: "Root context", postText: "Root context" },
      { draft: null },
    ],
  });
  await expect(page("intruder")).rejects.toMatchObject({ status: 403 });
  await expect(act("save", "Not allowed", "intruder")).rejects.toMatchObject({
    status: 403,
  });
  expect(await act("save", "Agent draft")).toMatchObject({
    message: "Draft saved. Review it before pressing Send.",
  });
  expect(await act("save", "Saved human edit")).toMatchObject({
    message: expect.any(String),
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(await page()).toMatchObject({
    replies: [
      { replyId: "reader", draft: "Saved human edit" },
      { replyId: "another", draft: null },
    ],
  });
  // The Send form submits the saved draft from the page, not textarea edits.
  expect(await act("send", "Unreviewed edit")).toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
  await t.mutation(api.replies.saveDraft, {
    secret: "test-secret",
    replyId: "reader",
    text: "Agent replacement",
  });
  expect(await act("send", "Saved human edit")).toMatchObject({
    status: 400,
    data: { error: expect.stringContaining("review it again") },
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(await page()).toMatchObject({
    replies: [{ replyId: "reader", draft: "Agent replacement" }, { draft: null }],
  });
  await act("save", "Saved human edit");
  await page();
  expect(await act("send", "Saved human edit")).toEqual({
    message: "Saved draft sent",
  });
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(await page()).toMatchObject({ replies: [{ replyId: "another" }] });
  const calls = fetch.mock.calls.length;
  expect(await act("send")).toMatchObject({ status: 400 });
  expect(fetch).toHaveBeenCalledTimes(calls);
  await act("save", "Another draft");
  await act("discard");
  expect(
    (
      await t.query(api.replies.list, {
        secret: "test-secret",
        unanswered: false,
        drafted: true,
      })
    ).replies,
  ).toEqual([]);
});
