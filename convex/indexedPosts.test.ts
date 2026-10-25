import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { dimensions, insertPost, patchPost, viewOf } from "./lib/postStore";
import type { RemovalPage } from "./sync";
import {
  connectThreads,
  fixtureWorkspace,
  ownerTest,
  workspaceIdOf,
} from "./testing/workspace.test-support";

const day = 86_400_000;
const now = Date.parse("2026-10-18T22:45:00Z"); // 05:45 WIB
const midnight = Date.parse("2026-10-18T17:00:00Z");
const at = (hour: number) => midnight + hour * 3_600_000;
const settings = {
  windows: [{ start: "06:00", end: "12:00" }],
  intervalMinutes: 30,
  timeZone: "Asia/Jakarta" as const,
  gapPolicy: "autoFill" as const,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

type Test = Awaited<ReturnType<typeof ownerTest>>;

async function seedHistory(t: Test, published: number, drafts = 0) {
  for (let start = 0; start < published + drafts; start += 100) {
    await t.run(async (ctx) => {
      for (let i = start; i < Math.min(start + 100, published + drafts); i++) {
        await ctx.db.insert("posts", {
          workspaceId: await fixtureWorkspace(ctx),
          parts: [{ text: `history ${i} ${"x".repeat(200)}` }],
          publishedIds: i < published ? [`history-${i}`] : [],
          source: "threads",
          meta: { topic: i % 2 ? "T1" : "T2", angle: "A1", format: "F1" },
          status:
            i < published
              ? {
                  kind: "published",
                  at: now - 400 * day + i,
                  permalink: `https://threads.net/${i}`,
                }
              : { kind: "draft" },
        });
      }
    });
  }
}

async function backfill(t: Test) {
  let indexed = 0;
  for (let i = 0; i < 100; i++) {
    const result = await t.mutation(internal.library.backfillPostStats, {
      workspaceId: await workspaceIdOf(t),
    });
    indexed += result.indexed;
    if (result.done) return indexed;
  }
  throw new Error("Backfill did not finish");
}

const draft = (t: Test, text: string) =>
  t.mutation(api.posts.createDraft, {
    source: "agent",
    parts: [{ text }],
    meta: { topic: "T1", angle: "A1", format: "F1" },
  });

test("queue, move, swap, compaction, reconnect, sweep and schedule ignore historical posts and drafts", async () => {
  const results = [];
  for (const history of [0, 2000]) {
    // A history scan would exceed this budget; seed writes do not read posts.
    const t = await ownerTest({
      transactionLimits: { documentsRead: 500 },
    });
    await seedHistory(t, history, history ? 1200 : 0);
    await t.mutation(api.posts.updateSettings, { ...settings });
    await t.run(async (ctx) => {
      await insertPost(ctx, {
        workspaceId: await fixtureWorkspace(ctx),
        parts: [{ text: "future published" }],
        publishedIds: ["future"],
        source: "threads",
        status: {
          kind: "published",
          at: at(6),
          permalink: "https://threads.net/future",
        },
      });
      await insertPost(ctx, {
        workspaceId: await fixtureWorkspace(ctx),
        parts: [{ text: "held" }],
        publishedIds: [],
        source: "web",
        status: { kind: "held", at: at(5), heldAt: now, reason: "reconnect" },
      });
    });
    const first = await draft(t, "first");
    const second = await draft(t, "second");
    expect(await t.mutation(api.posts.queue, { id: first })).toBe(at(6.5));
    expect(await t.mutation(api.posts.queue, { id: second })).toBe(at(7));
    await expect(
      t.mutation(api.posts.move, { id: first, at: at(6) }),
    ).rejects.toThrow("already taken");
    expect(await t.mutation(api.posts.move, { id: first, at: at(8) })).toBe(
      at(8),
    );
    await t.mutation(api.posts.swap, { id: first, otherId: second });
    const snapshot = await t.query(api.posts.schedule, {
      from: midnight,
      days: 7,
      day: midnight,
    });
    results.push({
      counts: snapshot.counts,
      held: snapshot.held,
      nextSlot: snapshot.nextSlot,
      posts: snapshot.posts.map((p) => ({
        text: p.parts[0].text,
        at: p.at,
        status: p.status.kind,
        pinned: p.pinned,
      })),
    });
    expect(snapshot.counts).toEqual([4, 0, 0, 0, 0, 0, 0]);
    await t.mutation(api.posts.unqueue, { id: first });
    await connectThreads(t, {
      threadsUserId: "owner",
      username: "owner",
      accessToken: "test-token",
      tokenExpiresAt: now + day,
    });
    const recovered = await t.query(api.posts.schedule, {
      from: midnight,
      days: 7,
      day: midnight,
    });
    expect(recovered.held).toBe(0);
    const stuck = await draft(t, "stuck");
    await t.run(async (ctx) =>
      patchPost(ctx, stuck, {
        status: {
          kind: "publishing",
          at: now,
          startedAt: now - 20 * 60_000,
          attempt: 3,
        },
      }),
    );
    await t.mutation(internal.publishing.sweepStuck, {});
    expect(
      (await t.query(internal.publishing.getPost, { id: stuck }))?.status.kind,
    ).toBe("failed");
  }
  expect(results[1]).toEqual(results[0]);
});

test("default published page stays below a fixed read budget after a batched backfill", async () => {
  const t = await ownerTest({
    transactionLimits: { documentsRead: 500 },
  });
  await seedHistory(t, 2000, 1200);
  expect(await backfill(t)).toBe(3200);
  expect(await backfill(t)).toBe(0);
  const page = await t.query(api.library.page, { view: "published" });
  expect(page.items).toHaveLength(25);
  expect(
    (
      await t.query(api.library.page, {
        view: "published",
        sort: "date",
        text: "",
      })
    ).items,
  ).toEqual(page.items);
  expect(page.items[0].parts[0].text).toContain("history 1999 ");
  expect(page.total).toBe(2000);
  expect(page.counts).toEqual({
    drafts: 1200,
    scheduled: 0,
    published: 2000,
    failed: 0,
  });
  expect(page.facets).toEqual({
    topic: { T1: 1000, T2: 1000 },
    angle: { A1: 2000 },
    format: { F1: 2000 },
  });
  // Synced historical posts do not enter metric refresh or the seven-day reply scan.
  for (let start = 0; start < 2000; start += 100) {
    await t.run(async (ctx) => {
      const posts = await ctx.db
        .query("posts")
        .withIndex("by_kind_at", (q) =>
          q
            .eq("status.kind", "published")
            .gte("status.at", now - 400 * day + start)
            .lt("status.at", now - 400 * day + start + 100),
        )
        .collect();
      for (const post of posts)
        await patchPost(ctx, post._id, {
          metrics: {
            views: 1,
            likes: 0,
            replies: 0,
            reposts: 0,
            quotes: 0,
            shares: 0,
            syncedAt: now,
          },
        });
    });
  }
  expect(
    await t.query(internal.sync.metricTargets, {
      workspaceId: await workspaceIdOf(t),
    }),
  ).toEqual([]);
  expect(
    await t.query(internal.replies.targets, {
      workspaceId: await workspaceIdOf(t),
    }),
  ).toEqual([]);
});

async function assertRecount(t: Test) {
  const posts = await t.run(async (ctx) => ctx.db.query("posts").collect());
  const counts = { drafts: 0, scheduled: 0, published: 0, failed: 0 };
  for (const post of posts) counts[viewOf(post)]++;
  for (const view of ["drafts", "scheduled", "published", "failed"] as const) {
    for (const filters of [
      {},
      { topic: "T1" },
      { topic: "T1", angle: "A1", format: "F1" },
      { text: "match" },
    ]) {
      const page = await t.query(api.library.page, {
        view,
        ...filters,
        limit: 100,
      });
      const inView = posts.filter(
        (p) =>
          viewOf(p) === view &&
          (!filters.text ||
            [
              ...p.parts.map((part) => part.text),
              p.meta?.hook ?? "",
              p.meta?.notes ?? "",
            ].some((text) => text.toLowerCase().includes(filters.text))),
      );
      const matches = (p: Doc<"posts">, ignore?: (typeof dimensions)[number]) =>
        dimensions.every(
          (d) =>
            d === ignore ||
            filters[d] === undefined ||
            p.meta?.[d] === filters[d],
        );
      const facets = Object.fromEntries(
        dimensions.map((d) => {
          const values = new Map<string, number>();
          for (const p of inView) {
            const code = p.meta?.[d];
            if (code !== undefined && matches(p, d))
              values.set(code, (values.get(code) ?? 0) + 1);
          }
          return [d, Object.fromEntries(values)];
        }),
      );
      expect(page.counts).toEqual(counts);
      expect(page.total).toBe(inView.filter((p) => matches(p)).length);
      expect(page.facets).toEqual(facets);
    }
  }
}

test("counts and facets match a recount across all views through status and tag changes", async () => {
  const t = await ownerTest();
  await t.mutation(api.posts.updateSettings, { ...settings });
  await t.run(async (ctx) => {
    for (const status of [
      { kind: "published", at: now - day, permalink: "url" },
      { kind: "held", at: now - day, heldAt: now, reason: "reconnect" },
      { kind: "failed", at: now, error: "failed" },
    ] satisfies Doc<"posts">["status"][]) {
      await insertPost(ctx, {
        workspaceId: await fixtureWorkspace(ctx),
        parts: [{ text: "seed match" }],
        publishedIds: [],
        source: "agent",
        status,
        meta: { topic: "T2", angle: "A2", format: "F1", notes: "match" },
      });
    }
  });
  const id = await draft(t, "match lifecycle");
  await assertRecount(t);
  await t.mutation(api.posts.queue, { id });
  await assertRecount(t);
  await t.mutation(api.posts.unqueue, { id });
  await assertRecount(t);
  await t.mutation(api.posts.publishNow, { id });
  await assertRecount(t);
  let post = await t.query(internal.publishing.getPost, { id });
  if (post?.status.kind !== "publishing")
    throw new Error("Expected publishing");
  await t.mutation(internal.publishing.complete, {
    id,
    startedAt: post.status.startedAt,
    result: { kind: "failed", error: "rejected", needsReconnect: false },
  });
  await assertRecount(t);
  await t.mutation(api.posts.updateDraft, {
    id,
    meta: { topic: "T2", angle: "A1", format: "F2" },
  });
  await t.mutation(api.posts.retry, { id });
  await assertRecount(t);
  post = await t.query(internal.publishing.getPost, { id });
  if (post?.status.kind !== "publishing")
    throw new Error("Expected publishing");
  await t.mutation(internal.publishing.recordId, {
    id,
    startedAt: post.status.startedAt,
    index: 0,
    threadsId: "published-root",
  });
  await t.mutation(internal.publishing.complete, {
    id,
    startedAt: post.status.startedAt,
    result: {
      kind: "published",
      permalink: "https://threads.net/published-root",
    },
  });
  await assertRecount(t);
  await t.mutation(api.library.tagPosts, {
    posts: [{ id, meta: { topic: "T1", format: "F1" } }],
  });
  await assertRecount(t);
  await t.mutation(api.posts.deletePost, { id });
  await assertRecount(t);
});

test("backfill matches a recount and remains idempotent with edits, imports and deletes between batches", async () => {
  const t = await ownerTest();
  await seedHistory(t, 120, 25);
  const before = await t.query(api.library.page, { view: "published" });
  const first = await t.mutation(internal.library.backfillPostStats, {
    workspaceId: await workspaceIdOf(t),
  });
  expect(first.indexed).toBe(100);
  expect(first.done).toBe(false);
  const legacy = await t.run(async (ctx) =>
    ctx.db
      .query("posts")
      .withIndex("by_libraryIndexed", (q) => q.eq("libraryIndexed", undefined))
      .collect(),
  );
  await t.mutation(api.library.tagPosts, {
    posts: [{ id: legacy[0]._id, meta: { topic: "T3" } }],
  });
  await t.mutation(api.posts.deletePost, { id: legacy[1]._id });
  await t.mutation(internal.sync.importPage, {
    workspaceId: await workspaceIdOf(t),
    posts: [
      { id: "new-import", text: "match", at: now - day, permalink: "url" },
    ],
  });
  await assertRecount(t);
  await backfill(t);
  await assertRecount(t);
  const stats = await t.run(async (ctx) => ctx.db.query("postStats").unique());
  expect(await backfill(t)).toBe(0);
  expect(
    await t.run(async (ctx) => ctx.db.query("postStats").unique()),
  ).toEqual(stats);
  expect((await t.query(api.library.page, { view: "published" })).total).toBe(
    before.total,
  );
});

test("published date pagination preserves id ties and search preserves creation-order score ties", async () => {
  const t = await ownerTest();
  await t.run(async (ctx) => {
    for (let i = 0; i < 40; i++)
      await insertPost(ctx, {
        workspaceId: await fixtureWorkspace(ctx),
        parts: [{ text: `tie ${i}` }],
        publishedIds: [],
        source: "threads",
        status: { kind: "published", at: now, permalink: "url" },
      });
  });
  const all = await t.run(async (ctx) => ctx.db.query("posts").collect());
  const expected = [...all].sort(
    (a, b) => b._creationTime - a._creationTime || a._id.localeCompare(b._id),
  );
  for (const offset of [0, 10, 25]) {
    const page = await t.query(api.library.page, {
      view: "published",
      offset,
      limit: 10,
    });
    expect(page.items.map((p) => p.id)).toEqual(
      expected.slice(offset, offset + 10).map((p) => p._id),
    );
  }
  const search = await t.query(api.library.searchPosts, {
    status: "published",
  });
  expect(search.map((p) => p.id)).toEqual(all.map((p) => p._id));
});

test("sync removal pages cross deleted cursors, verify current rows and keep counters consistent", async () => {
  const t = await ownerTest({
    transactionLimits: { documentsRead: 500 },
  });
  await seedHistory(t, 1200);
  await backfill(t);
  let cursor: string | null = null;
  let removed = 0;
  let preserved = 0;
  while (true) {
    const candidates: RemovalPage = await t.query(
      internal.sync.removalCandidates,
      { workspaceId: await workspaceIdOf(t), cutoff: now, cursor },
    );
    const missing = candidates.page.filter((_, i) => i % 2 === 0);
    preserved += candidates.page.length - missing.length;
    removed += await t.mutation(internal.sync.removeMissing, {
      workspaceId: await workspaceIdOf(t),
      posts: missing,
      cutoff: now,
    });
    // Repeating a committed delete batch cannot decrement counters twice.
    expect(
      await t.mutation(internal.sync.removeMissing, {
        workspaceId: await workspaceIdOf(t),
        posts: missing,
        cutoff: now,
      }),
    ).toBe(0);
    if (candidates.isDone) break;
    cursor = candidates.continueCursor;
  }
  expect(removed).toBe(600);
  expect(preserved).toBe(600);
  const page = await t.query(api.library.page, { view: "published" });
  expect(page.counts.published).toBe(600);
  expect(page.total).toBe(600);
  expect(
    Object.values(page.facets.topic).reduce((sum, count) => sum + count, 0),
  ).toBe(600);
});

test("status/date indexes retain insight group order from post creation", async () => {
  const t = await ownerTest();
  await t.run(async (ctx) => {
    for (const [topic, time] of [
      ["T1", now + 100],
      ["T2", now],
    ] as const) {
      await insertPost(ctx, {
        workspaceId: await fixtureWorkspace(ctx),
        parts: [{ text: topic }],
        publishedIds: [topic],
        source: "threads",
        meta: { topic },
        status: { kind: "published", at: time, permalink: "url" },
        metrics: {
          views: 10,
          likes: 1,
          replies: 0,
          reposts: 0,
          quotes: 0,
          shares: 0,
          syncedAt: now,
        },
      });
    }
  });
  const insights = await t.query(api.library.insights, {
    dimensions: ["topic"],
    since: new Date(now - 1).toISOString(),
    until: new Date(now + 101).toISOString(),
  });
  expect(insights.groups.map((group) => group.tags.topic)).toEqual([
    "T1",
    "T2",
  ]);
  const search = await t.query(api.library.searchPosts, {
    status: "published",
    since: new Date(now).toISOString(),
    until: new Date(now + 100).toISOString(),
  });
  expect(search.map((post) => post.text)).toEqual(["T2"]);
});
