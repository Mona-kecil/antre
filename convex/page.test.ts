import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { storeTestImage } from "./testing/storage";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const secret = "test-secret";

beforeEach(() => {
  vi.stubEnv("ANTRE_SECRET", secret);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T04:00:00Z"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("post pages filter text and taxonomy, count facets before their own filter, and sort each view before paging", async () => {
  const t = convexTest(schema, modules);
  const imageId = await t.run((ctx) =>
    storeTestImage(ctx, new Blob(["PNG"], { type: "image/png" })),
  );
  const drafts = [];
  for (const [text, meta] of [
    ["needle in part", { topic: "T01", angle: "A01", format: "F01" }],
    [
      "hook match",
      { topic: "T01", angle: "A02", format: "F02", hook: "NEEDLE hook" },
    ],
    [
      "notes match",
      { topic: "T02", angle: "A01", format: "F02", notes: "Needle notes" },
    ],
    ["other", { topic: "T02", angle: "A02", format: "F01" }],
    ["needle untagged", {}],
  ] as const) {
    vi.advanceTimersByTime(1);
    drafts.push(
      await t.mutation(api.posts.createDraft, {
        secret,
        source: "agent",
        parts: [{ text }, { text: "second part", imageId }],
        meta,
      }),
    );
  }
  const scheduled = [];
  for (const [kind, at] of [
    ["queued", 30],
    ["publishing", 20],
  ] as const) {
    const id = await t.mutation(api.posts.createDraft, {
      secret,
      source: "web",
      parts: [{ text: kind }],
    });
    if (kind === "queued")
      await t.mutation(api.posts.queue, { secret, id, at: Date.now() + at });
    else
      await t.run((ctx) =>
        ctx.db.patch(id, {
          status: { kind, at: Date.now() + at, startedAt: Date.now() },
        }),
      );
    scheduled.push(id);
  }
  const published = await t.run(async (ctx) => {
    const ids = [];
    for (const [at, views, likes] of [
      [300, 100, 5],
      [200, 300, 30],
      [100, 200, 100],
    ])
      ids.push(
        await ctx.db.insert("posts", {
          parts: [{ text: `published ${at}` }],
          publishedIds: [String(at)],
          source: "threads",
          status: {
            kind: "published",
            at,
            permalink: `https://threads.net/${at}`,
          },
          metrics: {
            views,
            likes,
            replies: 0,
            reposts: 0,
            quotes: 0,
            shares: 0,
            syncedAt: Date.now(),
          },
        }),
      );
    await ctx.db.insert("posts", {
      parts: [{ text: "failed" }],
      publishedIds: [],
      source: "agent",
      status: { kind: "failed", at: 400, error: "failed" },
    });
    return ids;
  });
  const first = await t.query(api.library.page, {
    secret,
    view: "drafts",
    limit: 2,
  });
  const counts = { drafts: 5, scheduled: 2, published: 3, failed: 1 };
  expect(first.total).toBe(5);
  expect(first.counts).toEqual(counts);
  expect(first.items.map((item) => item.id)).toEqual([drafts[4], drafts[3]]);
  expect(first.items[0]).toMatchObject({
    status: { kind: "draft" },
    source: "agent",
    metrics: null,
    engagement: null,
    _creationTime: expect.any(Number),
    parts: [
      { text: "needle untagged" },
      {
        text: "second part",
        imageId,
        imageUrl: expect.stringMatching(/^https?:\/\//),
      },
    ],
  });
  const next = await t.query(api.library.page, {
    secret,
    view: "drafts",
    offset: 2,
    limit: 2,
  });
  expect(next.items.map((item) => item.id)).toEqual([drafts[2], drafts[1]]);
  expect(next.total).toBe(5);
  expect(next.facets).toEqual(first.facets);
  expect(
    await t.query(api.library.page, { secret, view: "drafts", offset: 10 }),
  ).toMatchObject({ total: 5, items: [], counts });
  expect(
    (
      await t.query(api.library.page, {
        secret,
        view: "drafts",
        text: "NeEdLe",
      })
    ).total,
  ).toBe(4);
  expect(
    (
      await t.query(api.library.page, {
        secret,
        view: "drafts",
        text: "SECOND PART",
      })
    ).total,
  ).toBe(5);

  const filtered = await t.query(api.library.page, {
    secret,
    view: "drafts",
    topic: "T01",
    angle: "A01",
    text: "needle",
  });
  expect(filtered.items.map((item) => item.id)).toEqual([drafts[0]]);
  expect(filtered.total).toBe(1);
  expect(filtered.counts).toEqual(counts);
  expect(filtered.facets).toEqual({
    topic: { T01: 1, T02: 1 },
    angle: { A01: 1, A02: 1 },
    format: { F01: 1 },
  });
  const empty = await t.query(api.library.page, {
    secret,
    view: "drafts",
    topic: "T01",
    angle: "A01",
    format: "F02",
  });
  expect(empty.total).toBe(0);
  expect(empty.facets).toEqual({
    topic: { T02: 1 },
    angle: { A02: 1 },
    format: { F01: 1 },
  });
  const queue = await t.query(api.library.page, { secret, view: "scheduled" });
  expect(queue.items.map((item) => item.id)).toEqual([...scheduled].reverse());
  expect(queue.items[0].status).toMatchObject({
    kind: "publishing",
    at: expect.any(Number),
    startedAt: expect.any(Number),
  });
  expect(
    (await t.query(api.library.page, { secret, view: "failed" })).total,
  ).toBe(1);
  expect(
    (await t.query(api.library.page, { secret, view: "published" })).items.map(
      (item) => item.id,
    ),
  ).toEqual(published);
  expect(
    (
      await t.query(api.library.page, {
        secret,
        view: "published",
        sort: "views",
        limit: 2,
      })
    ).items.map((item) => item.id),
  ).toEqual([published[1], published[2]]);
  const engaged = await t.query(api.library.page, {
    secret,
    view: "published",
    sort: "engagement",
  });
  expect(engaged.items.map((item) => item.id)).toEqual(
    [...published].reverse(),
  );
  expect(engaged.items[0].engagement).toBe(0.5);

  await expect(
    t.query(api.library.page, { secret: "wrong", view: "drafts" }),
  ).rejects.toThrow("Unauthorized");
  for (const offset of [-1, 1.5])
    await expect(
      t.query(api.library.page, { secret, view: "drafts", offset }),
    ).rejects.toThrow("Offset");
  for (const limit of [0, 1.5, 101])
    await expect(
      t.query(api.library.page, { secret, view: "drafts", limit }),
    ).rejects.toThrow("Limit");
  await expect(
    t.query(api.library.page, { secret, view: "drafts", sort: "views" }),
  ).rejects.toThrow("published view");
});

test("post pages default to 25 rows, allow 100, and break tied dates consistently", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 102; i++)
      await ctx.db.insert("posts", {
        parts: [{ text: String(i) }],
        publishedIds: [],
        source: "agent",
        status: { kind: "draft" },
      });
  });
  const defaults = await t.query(api.library.page, { secret, view: "drafts" });
  expect(defaults.items).toHaveLength(25);
  expect(defaults.total).toBe(102);
  const first = await t.query(api.library.page, {
    secret,
    view: "drafts",
    limit: 100,
  });
  const last = await t.query(api.library.page, {
    secret,
    view: "drafts",
    offset: 100,
    limit: 100,
  });
  expect(first.items).toHaveLength(100);
  expect(last.items).toHaveLength(2);
  expect(
    new Set([...first.items, ...last.items].map((item) => item.id)).size,
  ).toBe(102);
  expect(defaults.items).toEqual(first.items.slice(0, 25));
});
