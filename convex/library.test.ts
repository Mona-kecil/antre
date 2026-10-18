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

test("sync pages imports, preserves antre threads without duplicates, refreshes metrics, and repeats without new posts", async () => {
  const t = convexTest(schema, modules);
  const existing = await t.run(async (ctx) => {
    await ctx.db.insert("account", {
      threadsUserId: "owner",
      username: "owner",
      accessToken: "test-token",
      tokenExpiresAt: now + 86400000,
      needsReconnect: false,
    });
    return await ctx.db.insert("posts", {
      parts: [{ text: "antre root" }, { text: "part 2" }],
      publishedIds: ["antre-root", "antre-reply"],
      source: "agent",
      meta: { topic: "CUSTOM" },
      status: {
        kind: "published",
        at: now,
        permalink: "https://threads.net/antre-root",
      },
    });
  });
  const calls: string[] = [];
  let permissionError = false;
  let publishing = false;
  const post = (id: string, timestamp = "2026-10-17T20:00:00+0000") => ({
    id,
    text: id,
    timestamp,
    permalink: `https://threads.net/${id}`,
    media_type: "TEXT_POST",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL, init: RequestInit) => {
      const url = new URL(input);
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer test-token",
      );
      calls.push(url.pathname);
      if (url.pathname === "/v1.0/me/threads") {
        expect(url.searchParams.get("fields")).toBe(
          "id,text,timestamp,permalink,media_type",
        );
        if (publishing)
          return Response.json({
            data: [
              post("publishing-root", "2026-10-18T04:00:00Z"),
              post("older-external", "2026-10-18T03:58:00Z"),
            ],
          });
        if (url.searchParams.get("after") === "page2")
          return Response.json({
            data: [
              post("old-external", "2025-01-01T00:00:00Z"),
              ...(permissionError ? [post("permission-post")] : []),
            ],
          });
        return Response.json({
          data: [post("antre-root"), post("external")],
          paging: {
            cursors: { after: "page2" },
            next: "https://graph.threads.net/v1.0/me/threads?after=page2",
          },
        });
      }
      if (permissionError)
        return Response.json(
          {
            error: {
              type: "OAuthException",
              code: 10,
              message: "Missing threads_manage_insights test-token",
            },
          },
          { status: 400 },
        );
      if (url.pathname === "/v1.0/owner/threads_insights") {
        expect(url.searchParams.get("metric")).toBe("followers_count");
        return Response.json({
          data: [{ name: "followers_count", total_value: { value: 1234 } }],
        });
      }
      expect(url.searchParams.get("metric")).toBe(
        "views,likes,replies,reposts,quotes,shares",
      );
      return Response.json({
        data: [
          { name: "views", values: [{ value: 100 }] },
          { name: "likes", total_value: { value: 10 } },
          { name: "replies", values: [{ value: 2 }] },
          { name: "reposts", total_value: { value: 3 } },
          { name: "quotes", values: [{ value: 1 }] },
        ],
      });
    }),
  );
  await expect(t.action(api.sync.now, { secret: "wrong" })).rejects.toThrow(
    "Unauthorized",
  );
  expect(await t.action(api.sync.now, { secret })).toEqual({
    imported: 2,
    metricsUpdated: 3,
    error: null,
  });
  const posts = await t.query(api.posts.listQueue, { secret });
  expect(posts).toHaveLength(3);
  expect(posts.filter((p) => p.publishedIds[0] === "antre-root")).toHaveLength(
    1,
  );
  expect(posts.find((p) => p._id === existing)).toMatchObject({
    parts: [{ text: "antre root" }, { text: "part 2" }],
    source: "agent",
    meta: { topic: "CUSTOM" },
  });
  expect(posts.find((p) => p.publishedIds[0] === "external")).toMatchObject({
    source: "threads",
    parts: [{ text: "external" }],
    status: {
      kind: "published",
      at: Date.parse("2026-10-17T20:00:00Z"),
      permalink: "https://threads.net/external",
    },
    metrics: {
      views: 100,
      likes: 10,
      replies: 2,
      reposts: 3,
      quotes: 1,
      shares: 0,
      syncedAt: now,
    },
  });
  expect(await t.action(internal.sync.run, {})).toEqual({
    imported: 0,
    metricsUpdated: 2,
    error: null,
  });
  expect(await t.query(api.posts.listQueue, { secret })).toHaveLength(3);
  expect(calls.filter((p) => p === "/v1.0/old-external/insights")).toHaveLength(
    1,
  );
  expect(await t.run((ctx) => ctx.db.query("followers").collect())).toEqual([
    expect.objectContaining({ at: now, count: 1234 }),
  ]);
  permissionError = true;
  const result = await t.action(api.sync.now, { secret });
  expect(result).toMatchObject({
    imported: 1,
    metricsUpdated: 0,
    error: expect.stringContaining("threads_manage_insights"),
  });
  expect(result.error).not.toContain("test-token");
  expect(
    (await t.query(api.posts.listQueue, { secret })).find(
      (p) => p.publishedIds[0] === "permission-post",
    ),
  ).toMatchObject({ source: "threads", status: { kind: "published" } });

  permissionError = false;
  publishing = true;
  const startedAt = now - 30_000;
  const inFlight = await t.run((ctx) =>
    ctx.db.insert("posts", {
      parts: [{ text: "publishing-root" }],
      publishedIds: [],
      source: "agent",
      status: { kind: "publishing", at: startedAt, startedAt },
    }),
  );
  expect(await t.action(api.sync.now, { secret })).toMatchObject({
    imported: 1,
    error: null,
  });
  const duringPublishing = await t.query(api.posts.listQueue, { secret });
  expect(duringPublishing).toHaveLength(6);
  expect(
    duringPublishing.filter((p) => p.publishedIds[0] === "publishing-root"),
  ).toHaveLength(0);
  expect(duringPublishing.find((p) => p._id === inFlight)).toMatchObject({
    publishedIds: [],
    status: { kind: "publishing" },
  });
  expect(
    duringPublishing.find((p) => p.publishedIds[0] === "older-external"),
  ).toMatchObject({ source: "threads", status: { kind: "published" } });
  expect(
    await t.mutation(internal.publishing.recordId, {
      id: inFlight,
      startedAt,
      index: 0,
      threadsId: "publishing-root",
    }),
  ).toBe(true);
  await t.mutation(internal.publishing.complete, {
    id: inFlight,
    startedAt,
    result: {
      kind: "published",
      permalink: "https://threads.net/publishing-root",
    },
  });
  expect(await t.action(api.sync.now, { secret })).toMatchObject({
    imported: 0,
    error: null,
  });
  const afterPublishing = await t.query(api.posts.listQueue, { secret });
  expect(afterPublishing).toHaveLength(6);
  expect(
    afterPublishing.filter((p) => p.publishedIds[0] === "publishing-root"),
  ).toMatchObject([
    { _id: inFlight, source: "agent", status: { kind: "published" } },
  ]);
});

test("taxonomy and partial tagging span statuses; grouping computes mean engagement, null tags, minimum views, and follower bounds", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.library.setTaxonomy, {
    secret,
    entries: [{ dimension: "topic", code: "CUSTOM", name: "Old name" }],
  });
  await t.mutation(api.library.setTaxonomy, {
    secret,
    entries: [
      {
        dimension: "topic",
        code: "CUSTOM",
        name: "Creative testing",
        description: "A user code",
      },
    ],
  });
  expect(await t.query(api.library.taxonomy, { secret })).toEqual([
    expect.objectContaining({ code: "CUSTOM", name: "Creative testing" }),
  ]);
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (const [text, views, likes, topic] of [
      ["first", 100, 10, "CUSTOM"],
      ["best", 300, 60, "CUSTOM"],
      ["untagged", 200, 10, undefined],
      ["low views", 9, 9, "CUSTOM"],
      ["zero views", 0, 0, undefined],
    ] as const) {
      ids.push(
        await ctx.db.insert("posts", {
          parts: [{ text }],
          publishedIds: [text],
          source: "threads",
          meta: topic ? { topic, notes: "keep" } : {},
          status: {
            kind: "published",
            at: Date.parse("2026-10-17T18:00:00Z"),
            permalink: `https://threads.net/${text}`,
          },
          metrics: {
            views,
            likes: topic === "CUSTOM" && views >= 100 ? likes - 6 : likes,
            replies: topic === "CUSTOM" && views >= 100 ? 2 : 0,
            reposts: topic === "CUSTOM" && views >= 100 ? 3 : 0,
            quotes: topic === "CUSTOM" && views >= 100 ? 1 : 0,
            shares: 100,
            syncedAt: now,
          },
        }),
      );
    }
    await ctx.db.insert("followers", {
      at: Date.parse("2026-10-16T00:00:00Z"),
      count: 10,
    });
    await ctx.db.insert("followers", { at: now, count: 20 });
    await ctx.db.insert("followers", { at: now + 86400000, count: 30 });
    return ids;
  });
  const draft = await t.mutation(api.posts.createDraft, {
    secret,
    source: "agent",
    parts: [{ text: "draft" }],
  });
  await t.mutation(api.library.tagPosts, {
    secret,
    posts: [
      { id: ids[0], meta: { hook: "New hook" } },
      { id: draft, meta: { topic: "CUSTOM", notes: "draft notes" } },
    ],
  });
  const posts = await t.query(api.library.searchPosts, {
    secret,
    status: "published",
    topic: "CUSTOM",
    text: "FIRST",
    since: "2026-10-18",
    until: "2026-10-18",
    minViews: 50,
    fullParts: true,
  });
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    id: ids[0],
    date: "2026-10-17T18:00:00.000Z",
    meta: { topic: "CUSTOM", notes: "keep", hook: "New hook" },
    engagement: 0.1,
    parts: [{ text: "first" }],
  });
  const result = await t.query(api.library.insights, {
    secret,
    dimensions: ["topic", "angle"],
    since: "2026-10-18",
    until: "2026-10-18",
    minViews: 50,
  });
  expect(result.groups).toHaveLength(2);
  expect(result.groups.find((g) => g.tags.topic === "CUSTOM")).toMatchObject({
    tags: { topic: "CUSTOM", angle: null },
    count: 2,
    totalViews: 400,
    averageViews: 200,
    bestPostId: ids[1],
  });
  expect(
    result.groups.find((g) => g.tags.topic === "CUSTOM")?.averageEngagement,
  ).toBeCloseTo(0.15);
  expect(result.groups.find((g) => g.tags.topic === null)).toMatchObject({
    tags: { topic: null, angle: null },
    count: 1,
    totalViews: 200,
    averageViews: 200,
    averageEngagement: 0.05,
    bestPostId: ids[2],
  });
  expect(result.followers).toMatchObject({
    start: { count: 10 },
    end: { count: 20 },
  });
  expect(
    await t.query(api.library.searchPosts, {
      secret,
      sort: "engagement",
      minViews: 50,
      limit: 1,
    }),
  ).toMatchObject([{ id: ids[1] }]);
});
