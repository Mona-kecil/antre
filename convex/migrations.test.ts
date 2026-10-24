import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { tokenHash } from "./access";
import schema from "./schema";
import { connectThreads } from "./testing/workspace.test-support";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
test("legacy backfill preserves IDs, tokens, settings, partial publications and scheduled jobs across repeated runs", async () => {
  vi.useFakeTimers();
  const root = convexTest(schema, modules);
  const now = Date.now();
  const rows = await root.run(async (ctx) => {
    const account = await ctx.db.insert("account", {
      threadsUserId: "legacy",
      username: "owner",
      accessToken: "legacy-platform-token",
      tokenExpiresAt: now + 100000,
      needsReconnect: false,
      lastRefreshError: "old error",
    });
    const linkedin = await ctx.db.insert("linkedinAccount", {
      memberId: "legacy-member",
      name: "Owner",
      accessToken: "legacy-linkedin-token",
      tokenExpiresAt: now + 100000,
      needsReconnect: false,
    });
    const settings = await ctx.db.insert("settings", {
      timeZone: "Asia/Jakarta",
      intervalMinutes: 45,
      windowStart: "07:00",
      windowEnd: "10:00",
    });
    const imageId = await ctx.storage.store(
      new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
        type: "image/png",
      }),
    );
    const post = await ctx.db.insert("posts", {
      parts: [{ text: "root", imageId }, { text: "remaining" }],
      source: "agent",
      publishedIds: ["partial-root"],
      status: { kind: "draft" },
    });
    const jobId = await ctx.scheduler.runAt(now + 60000, internal.posts.fire, {
      id: post,
      retry: true,
    });
    await ctx.db.patch(post, {
      status: { kind: "queued", at: now + 60000, jobId, retry: true },
    });
    const liPost = await ctx.db.insert("linkedinPosts", {
      text: "queued LinkedIn",
      source: "web",
      generation: 4,
      status: { kind: "draft" },
    });
    const liJobId = await ctx.scheduler.runAt(
      now + 120000,
      internal.linkedin.fire,
      { id: liPost, generation: 4 },
    );
    await ctx.db.patch(liPost, {
      status: {
        kind: "queued",
        at: now + 120000,
        jobId: liJobId,
        generation: 4,
      },
    });
    await ctx.db.insert("replies", {
      postId: post,
      threadsId: "reply",
      text: "reply",
      username: "reader",
      at: now,
      mine: false,
      hidden: false,
      draft: "saved answer",
    });
    await ctx.db.insert("taxonomy", {
      dimension: "topic",
      code: "T1",
      name: "Legacy taxonomy",
    });
    await ctx.db.insert("followers", { at: now, count: 42 });
    await ctx.db.insert("postStats", {
      counts: { drafts: 999, scheduled: 0, published: 0, failed: 0 },
      publishedFacets: [],
    });
    return { account, linkedin, settings, post, liPost, jobId, liJobId };
  });
  const before = await root.query(internal.migrations.inventory, {});
  const beforeJobs = await root.run(async (ctx) => [
    await ctx.db.system.get(rows.jobId),
    await ctx.db.system.get(rows.liJobId),
  ]);
  const legacyTokenHash = await tokenHash("legacy-mcp-token");
  let result = await root.mutation(internal.migrations.backfill, {
    legacyTokenHash,
  });
  for (let round = 0; !result.done && round < 20; round++)
    result = await root.mutation(internal.migrations.backfill, {
      legacyTokenHash,
    });
  expect(result.done).toBe(true);
  expect(result.registered).toBe(1);
  const after = await root.query(internal.migrations.inventory, {});
  for (const original of before.tables)
    expect(
      after.tables.find((row) => row.table === original.table)?.count,
    ).toBe(
      original.count +
        (original.table === "assets"
          ? 1
          : original.table === "agentGrants"
            ? 1
            : original.table === "workspaceMigrations"
              ? 1
              : 0),
    );
  const again = await root.mutation(internal.migrations.backfill, {
    legacyTokenHash,
  });
  expect(again).toMatchObject({
    patched: 0,
    indexed: 0,
    registered: 0,
    done: true,
  });
  expect((await root.query(internal.migrations.inventory, {})).jobs).toEqual(
    before.jobs,
  );
  expect(
    await root.run(async (ctx) => [
      await ctx.db.system.get(rows.jobId),
      await ctx.db.system.get(rows.liJobId),
    ]),
  ).toEqual(beforeJobs);
  expect(await root.run((ctx) => ctx.db.get(rows.account))).toMatchObject({
    workspaceId: result.workspaceId,
    accessToken: "legacy-platform-token",
    lastRefreshError: "old error",
  });
  expect(await root.run((ctx) => ctx.db.get(rows.linkedin))).toMatchObject({
    workspaceId: result.workspaceId,
    accessToken: "legacy-linkedin-token",
  });
  expect(await root.run((ctx) => ctx.db.get(rows.post))).toMatchObject({
    publishedIds: ["partial-root"],
    status: { jobId: rows.jobId, at: now + 60000, retry: true },
  });
  expect(await root.run((ctx) => ctx.db.get(rows.settings))).toMatchObject({
    timeZone: "Asia/Jakarta",
    intervalMinutes: 45,
    windowStart: "07:00",
    windowEnd: "10:00",
  });
  await expect(
    root.query(api.posts.listQueue, { secret: "legacy-mcp-token" }),
  ).rejects.toThrow("Workspace unavailable");
  const stranger = root.withIdentity({ subject: "stranger" });
  await stranger.mutation(api.workspaces.ensure, {});
  expect(await stranger.query(api.account.current, {})).toBeNull();
  await expect(
    connectThreads(stranger, {
      threadsUserId: "legacy",
      username: "claim",
      accessToken: "x",
      tokenExpiresAt: now + 100000,
    }),
  ).rejects.toThrow("already connected");
  const owner = root.withIdentity({ subject: "verified-legacy" });
  expect(await owner.query(api.workspaces.current, {})).toBeNull();
  await owner.mutation(api.workspaces.ensure, {});
  expect(
    await root.mutation(internal.workspaces.bindLegacyOwner, {
      subject: "verified-legacy",
    }),
  ).toBe(result.workspaceId);
  expect(
    await root.mutation(internal.workspaces.bindLegacyOwner, {
      subject: "verified-legacy",
    }),
  ).toBe(result.workspaceId);
  await expect(
    root.mutation(internal.workspaces.bindLegacyOwner, { subject: "stranger" }),
  ).rejects.toThrow("already bound");
  expect(await root.query(internal.migrations.check, {})).toEqual({
    ready: true,
    errors: [],
  });
  expect(await owner.query(api.account.current, {})).toMatchObject({
    threadsUserId: "legacy",
  });
  expect(
    (await root.query(api.posts.listQueue, { secret: "legacy-mcp-token" })).map(
      (post) => post._id,
    ),
  ).toEqual([rows.post]);
  expect(
    (await owner.query(api.library.page, { view: "scheduled" })).counts,
  ).toEqual({ drafts: 0, scheduled: 1, published: 0, failed: 0 });
  expect(
    await root.mutation(internal.migrations.backfill, { legacyTokenHash }),
  ).toMatchObject({ patched: 0, indexed: 0, registered: 0, done: true });
});
test("legacy binding refuses a user with non-empty workspace and cannot run before migration", async () => {
  const root = convexTest(schema, modules);
  const owner = root.withIdentity({ subject: "occupied" });
  await owner.mutation(api.workspaces.ensure, {});
  await owner.mutation(api.posts.createDraft, {
    source: "web",
    parts: [{ text: "new workspace content" }],
  });
  await root.mutation(internal.migrations.backfill, {});
  await expect(
    root.mutation(internal.migrations.bindLegacyOwner, { subject: "occupied" }),
  ).rejects.toThrow("non-empty workspace");
});

test("bounded migration resumes through row tagging and stats pages without double counting", async () => {
  const root = convexTest(schema, modules);
  await expect(
    root.mutation(internal.migrations.bindLegacyOwner, { subject: "owner" }),
  ).rejects.toThrow("Legacy workspace unavailable");
  await root.run(async (ctx) => {
    for (let index = 0; index < 251; index++)
      await ctx.db.insert("posts", {
        parts: [{ text: `legacy-${index}` }],
        source: "agent",
        publishedIds: [],
        status: { kind: "draft" },
      });
  });
  let result = await root.mutation(internal.migrations.backfill, {});
  expect(result).toMatchObject({ patched: 100, done: false });
  await expect(
    root.mutation(internal.migrations.bindLegacyOwner, { subject: "owner" }),
  ).rejects.toThrow("Complete legacy backfill");
  let rounds = 1;
  while (!result.done && rounds < 20) {
    result = await root.mutation(internal.migrations.backfill, {});
    rounds++;
  }
  expect(result.done).toBe(true);
  expect(rounds).toBeGreaterThan(3);
  expect(await root.mutation(internal.migrations.backfill, {})).toMatchObject({
    patched: 0,
    indexed: 0,
    registered: 0,
    done: true,
  });
  await root.mutation(internal.migrations.bindLegacyOwner, {
    subject: "owner",
  });
  const owner = root.withIdentity({ subject: "owner" });
  expect(
    (await owner.query(api.library.page, { view: "drafts" })).counts.drafts,
  ).toBe(251);
});
