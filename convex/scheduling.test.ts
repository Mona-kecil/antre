import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const secret = "test-secret";
const wib = (time: string) => Date.parse(`${time}+07:00`);
const day = 86_400_000;
const settings = {
  windows: [{ start: "06:00", end: "12:00" }],
  intervalMinutes: 30,
  timeZone: "Asia/Jakarta" as const,
  gapPolicy: "keepTimes" as const,
};

async function setup(gapPolicy: "autoFill" | "keepTimes" = "keepTimes") {
  const t = convexTest(schema, modules);
  const account = {
    threadsUserId: "owner",
    username: "owner",
    accessToken: "token",
    tokenExpiresAt: Date.now() + 60 * day,
  };
  await t.mutation(api.account.connect, { secret, ...account });
  await t.mutation(api.posts.updateSettings, {
    secret,
    ...settings,
    gapPolicy,
  });
  const draft = (text: string) =>
    t.mutation(api.posts.createDraft, {
      secret,
      source: "web",
      parts: [{ text }],
    });
  const get = (id: Id<"posts">) => t.query(internal.publishing.getPost, { id });
  const fire = async (id: Id<"posts">) => {
    const post = await get(id);
    if (post?.status.kind !== "queued") throw new Error("Expected queued post");
    await t.mutation(internal.posts.fire, {
      id,
      retry: post.status.retry ?? false,
      generation: post.status.generation,
    });
  };
  const block = async (expired = false) =>
    t.run(async (ctx) => {
      const row = await ctx.db.query("account").unique();
      if (!row) throw new Error("Missing account");
      await ctx.db.patch(
        row._id,
        expired ? { tokenExpiresAt: Date.now() - 1 } : { needsReconnect: true },
      );
    });
  return { t, account, draft, get, fire, block };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(wib("2026-10-19T05:45:00"));
  vi.stubEnv("ANTRE_SECRET", secret);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test.each([false, true])(
  "a due post is held when reconnect/expired=%s, with UI data",
  async (expired) => {
    const { t, draft, get, fire, block } = await setup();
    const id = await draft("blocked");
    const at = await t.mutation(api.posts.queue, { secret, id });
    await block(expired);
    vi.setSystemTime(at);
    await fire(id);
    expect(await get(id)).toMatchObject({
      status: { kind: "held", at, heldAt: at },
      pinned: false,
    });
    const account = await t.query(api.account.current, { secret });
    expect(account).toMatchObject({ needsReconnect: true });
    expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
      {
        _id: id,
        at,
        held: true,
        pinned: false,
        status: { kind: "held" },
        account,
      },
    ]);
    expect(
      await t.query(api.library.page, { secret, view: "scheduled" }),
    ).toMatchObject({
      items: [{ id, at, held: true, pinned: false, status: { kind: "held" } }],
      counts: { scheduled: 1, failed: 0 },
      account,
    });
  },
);

test.each(["autoFill", "keepTimes"] as const)(
  "reconnect re-slots held posts in order under %s",
  async (gapPolicy) => {
    const { t, account, draft, get, fire, block } = await setup(gapPolicy);
    const ids = [];
    for (const text of [
      "held first",
      "held second",
      "later first",
      "later second",
    ]) {
      const id = await draft(text);
      ids.push(id);
      await t.mutation(api.posts.queue, { secret, id });
    }
    const pin = await draft("pinned");
    const pinAt = wib("2026-10-19T08:00:00");
    await t.mutation(api.posts.queue, { secret, id: pin, at: pinAt });
    // A collision with the first held post's next-day clock time.
    const nextDayPin = await draft("next day pin");
    await t.mutation(api.posts.queue, {
      secret,
      id: nextDayPin,
      at: wib("2026-10-20T06:00:00"),
    });
    await block();
    vi.setSystemTime(wib("2026-10-19T06:00:00"));
    await fire(ids[0]);
    vi.setSystemTime(wib("2026-10-19T06:30:00"));
    await fire(ids[1]);
    const laterBefore = await Promise.all(ids.slice(2).map(get));
    vi.setSystemTime(wib("2026-10-19T06:45:00"));
    await t.mutation(api.account.connect, {
      secret,
      ...account,
      accessToken: "new-token",
    });
    const posts = await Promise.all(ids.map(get));
    expect(posts.map((post) => post?.status.kind)).toEqual([
      "queued",
      "queued",
      "queued",
      "queued",
    ]);
    expect(
      posts.map((post) =>
        post?.status.kind === "queued" ? post.status.at : null,
      ),
    ).toEqual(
      gapPolicy === "autoFill"
        ? [
            "2026-10-19T07:00:00",
            "2026-10-19T07:30:00",
            "2026-10-19T08:30:00",
            "2026-10-19T09:00:00",
          ].map(wib)
        : [
            "2026-10-20T06:30:00",
            "2026-10-20T07:00:00",
            "2026-10-19T07:00:00",
            "2026-10-19T07:30:00",
          ].map(wib),
    );
    expect(await get(pin)).toMatchObject({
      pinned: true,
      status: { kind: "queued", at: pinAt },
    });
    for (const post of laterBefore) {
      if (post?.status.kind !== "queued")
        throw new Error("Expected queued post");
      const jobId = post.status.jobId;
      expect(
        await t.run(
          async (ctx) => (await ctx.db.system.get(jobId))?.state.kind,
        ),
      ).toBe(gapPolicy === "autoFill" ? "canceled" : "pending");
    }
    const once = await Promise.all(ids.map(get));
    await t.mutation(api.account.connect, {
      secret,
      ...account,
      accessToken: "another-token",
    });
    expect(await Promise.all(ids.map(get))).toEqual(once);
  },
);

test.each(["unqueue", "deletePost", "publishNow"] as const)(
  "autoFill compacts on %s and preserves pins and order",
  async (operation) => {
    const { t, draft, get } = await setup("autoFill");
    const ids = [];
    for (const text of ["removed", "second", "pin", "fourth", "fifth"]) {
      const id = await draft(text);
      ids.push(id);
      await t.mutation(api.posts.queue, {
        secret,
        id,
        ...(text === "pin" ? { at: wib("2026-10-19T07:00:00") } : {}),
      });
    }
    const before = await Promise.all(ids.slice(1).map(get));
    await t.mutation(api.posts[operation], { secret, id: ids[0] });
    expect(
      (await Promise.all(ids.slice(1).map(get))).map((post) => ({
        at: post?.status.kind === "queued" ? post.status.at : null,
        pinned: post?.pinned,
      })),
    ).toEqual([
      { at: wib("2026-10-19T06:00:00"), pinned: false },
      { at: wib("2026-10-19T07:00:00"), pinned: true },
      { at: wib("2026-10-19T06:30:00"), pinned: false },
      { at: wib("2026-10-19T07:30:00"), pinned: false },
    ]);
    for (const post of before) {
      if (post?.status.kind !== "queued")
        throw new Error("Expected queued post");
      const jobId = post.status.jobId;
      expect(
        await t.run(
          async (ctx) => (await ctx.db.system.get(jobId))?.state.kind,
        ),
      ).toBe(post.pinned ? "pending" : "canceled");
    }
  },
);

test("move/swap exchange pins, reject past/taken times, cancel jobs, and fence stale fire", async () => {
  const { t, draft, get } = await setup();
  const first = await draft("first");
  const second = await draft("second");
  const oldAt = await t.mutation(api.posts.queue, { secret, id: first });
  const pinnedAt = wib("2026-10-19T07:00:00");
  await t.mutation(api.posts.queue, { secret, id: second, at: pinnedAt });
  const before = await get(first);
  if (before?.status.kind !== "queued") throw new Error("Expected queued post");
  const oldJob = before.status.jobId;
  const generation = before.status.generation;
  await expect(
    t.mutation(api.posts.move, { secret, id: first, at: Date.now() }),
  ).rejects.toThrow("future");
  await expect(
    t.mutation(api.posts.move, { secret, id: first, at: pinnedAt }),
  ).rejects.toThrow("already taken");
  const movedAt = wib("2026-10-19T08:00:00");
  await t.mutation(api.posts.move, { secret, id: first, at: movedAt });
  expect(await get(first)).toMatchObject({
    pinned: true,
    status: { kind: "queued", at: movedAt },
  });
  expect(
    await t.run(async (ctx) => (await ctx.db.system.get(oldJob))?.state.kind),
  ).toBe("canceled");
  // Once the new time arrives, an old generation must still have no effect.
  vi.setSystemTime(movedAt);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await t.mutation(internal.posts.fire, {
    id: first,
    retry: false,
    generation,
  });
  await t.mutation(internal.posts.fire, { id: first, retry: false });
  expect(await get(first)).toMatchObject({
    status: { kind: "queued", at: movedAt },
  });
  expect(fetch).not.toHaveBeenCalled();
  vi.setSystemTime(oldAt - 60_000);
  expect(await t.mutation(api.posts.move, { secret, id: first })).toBe(oldAt);
  const firstBeforeSwap = await get(first);
  const secondBeforeSwap = await get(second);
  await t.mutation(api.posts.swap, { secret, id: first, otherId: second });
  expect(await get(first)).toMatchObject({
    pinned: true,
    status: { kind: "queued", at: pinnedAt },
  });
  expect(await get(second)).toMatchObject({
    pinned: false,
    status: { kind: "queued", at: oldAt },
  });
  for (const post of [firstBeforeSwap, secondBeforeSwap]) {
    if (post?.status.kind !== "queued") throw new Error("Expected queued post");
    const jobId = post.status.jobId;
    expect(
      await t.run(async (ctx) => (await ctx.db.system.get(jobId))?.state.kind),
    ).toBe("canceled");
  }
  await expect(
    t.mutation(api.posts.swap, { secret, id: first, otherId: first }),
  ).rejects.toThrow("different");
});

test("settings sort and validate windows; slots span windows and WIB days without moving existing jobs", async () => {
  const { t, draft, get } = await setup();
  const existing = await draft("existing");
  await t.mutation(api.posts.queue, { secret, id: existing });
  const before = await get(existing);
  const windows = [
    { start: "13:00", end: "13:30" },
    { start: "06:00", end: "06:30" },
  ];
  const value = await t.mutation(api.posts.updateSettings, {
    secret,
    ...settings,
    windows,
  });
  expect(value.windows).toEqual([...windows].reverse());
  expect(await t.query(api.posts.getSettings, { secret })).toEqual(value);
  expect(await get(existing)).toEqual(before);
  const at = [];
  for (const text of ["a", "b", "c", "d"]) {
    at.push(
      await t.mutation(api.posts.queue, { secret, id: await draft(text) }),
    );
  }
  expect(at).toEqual(
    [
      "2026-10-19T06:30:00",
      "2026-10-19T13:00:00",
      "2026-10-19T13:30:00",
      "2026-10-20T06:00:00",
    ].map(wib),
  );
  for (const windows of [
    [],
    [{ start: "6:00", end: "07:00" }],
    [{ start: "08:00", end: "07:00" }],
    [
      { start: "06:00", end: "07:00" },
      { start: "07:00", end: "08:00" },
    ],
  ]) {
    await expect(
      t.mutation(api.posts.updateSettings, { secret, ...settings, windows }),
    ).rejects.toThrow();
  }
  for (const intervalMinutes of [4, 241, 5.5]) {
    await expect(
      t.mutation(api.posts.updateSettings, {
        secret,
        ...settings,
        intervalMinutes,
      }),
    ).rejects.toThrow("integer between 5 and 240");
  }
});

test("legacy settings migrate once, protect queued times, and recover the incident's auth failures", async () => {
  const { t, draft, get, account, block } = await setup();
  const id = await draft("legacy queued");
  const at = await t.mutation(api.posts.queue, { secret, id });
  const failed = await draft("incident");
  await block();
  await t.run(async (ctx) => {
    const row = await ctx.db.query("settings").unique();
    if (!row) throw new Error("Missing settings");
    await ctx.db.replace(row._id, {
      windowStart: "08:00",
      windowEnd: "10:00",
      intervalMinutes: 60,
      timeZone: "Asia/Jakarta",
    });
    await ctx.db.patch(id, { pinned: undefined });
    await ctx.db.patch(failed, {
      status: {
        kind: "failed",
        at,
        error: "Threads account needs reconnecting",
      },
    });
  });
  expect(await t.query(api.posts.getSettings, { secret })).toEqual({
    ...settings,
    windows: [{ start: "08:00", end: "10:00" }],
    intervalMinutes: 60,
  });
  expect(await t.mutation(internal.posts.migrateSettings, {})).toMatchObject({
    legacyPostsPinned: 1,
    authFailuresRecovered: 1,
  });
  expect(await get(id)).toMatchObject({
    pinned: true,
    status: { kind: "queued", at },
  });
  expect(await get(failed)).toMatchObject({ status: { kind: "held", at } });
  const migrated = await t.run((ctx) => ctx.db.query("settings").unique());
  expect(migrated).not.toHaveProperty("windowStart");
  expect(await t.mutation(internal.posts.migrateSettings, {})).toMatchObject({
    legacyPostsPinned: 0,
    authFailuresRecovered: 0,
  });
  await t.mutation(api.account.connect, {
    secret,
    ...account,
    accessToken: "new-token",
  });
  expect(await get(failed)).toMatchObject({
    status: { kind: "queued", at: at + day, retry: false },
  });
});

test("migration classifies legacy times on the legacy grid and preserves set pins", async () => {
  const { t, draft, get } = await setup();
  const cases = [
    { time: "07:45:00", pinned: false },
    { time: "07:10:00", pinned: true },
    { time: "15:00:00", pinned: true },
  ];
  const ids: Id<"posts">[] = [];
  for (const { time } of cases) {
    const id = await draft(time);
    ids.push(id);
    await t.mutation(api.posts.queue, {
      secret,
      id,
      at: wib(`2026-10-19T${time}`),
    });
  }
  await t.run(async (ctx) => {
    const row = await ctx.db.query("settings").unique();
    if (!row) throw new Error("Missing settings");
    await ctx.db.replace(row._id, {
      windowStart: "07:00",
      windowEnd: "09:00",
      intervalMinutes: 45,
      timeZone: "Asia/Jakarta",
    });
    for (const id of ids) await ctx.db.patch(id, { pinned: undefined });
  });
  const before = await Promise.all(ids.map(get));
  expect(await t.mutation(internal.posts.migrateSettings, {})).toMatchObject({
    settings: {
      windows: [{ start: "07:00", end: "09:00" }],
      intervalMinutes: 45,
    },
    legacyPostsPinned: 2,
    legacyPostsUnpinned: 1,
  });
  for (const [index, id] of ids.entries()) {
    expect(await get(id)).toEqual({
      ...before[index],
      pinned: cases[index].pinned,
    });
  }
  // Preserve explicit pins even when they differ from the inferred grid.
  await t.run(async (ctx) => {
    await ctx.db.patch(ids[0], { pinned: true });
    await ctx.db.patch(ids[1], { pinned: false });
  });
  const once = await Promise.all(ids.map(get));
  expect(await t.mutation(internal.posts.migrateSettings, {})).toMatchObject({
    legacyPostsPinned: 0,
    legacyPostsUnpinned: 0,
  });
  expect(await Promise.all(ids.map(get))).toEqual(once);
});

test("overdue queued posts never pull later posts into the past during compaction", async () => {
  const { t, draft, get } = await setup("keepTimes");
  const ids = [];
  for (const text of [
    "remove",
    "overdue one",
    "gap",
    "overdue two",
    "due",
    "future",
  ]) {
    const id = await draft(text);
    ids.push(id);
    await t.mutation(api.posts.queue, { secret, id });
  }
  await t.mutation(api.posts.unqueue, { secret, id: ids[2] });
  await t.mutation(api.posts.updateSettings, {
    secret,
    ...settings,
    gapPolicy: "autoFill",
  });
  vi.setSystemTime(wib("2026-10-19T08:00:00"));
  await t.mutation(api.posts.unqueue, { secret, id: ids[0] });
  expect(await get(ids[3])).toMatchObject({
    status: { kind: "queued", at: wib("2026-10-19T07:30:00") },
  });
  expect(await get(ids[5])).toMatchObject({
    status: { kind: "queued", at: wib("2026-10-19T08:30:00") },
  });
});

test("autoFill uses earlier free windows after the owner changes the windows", async () => {
  const { t, draft, get } = await setup("autoFill");
  const removed = await draft("removed");
  await t.mutation(api.posts.queue, {
    secret,
    id: removed,
    at: wib("2026-10-19T10:00:00"),
  });
  await t.mutation(api.posts.updateSettings, {
    secret,
    ...settings,
    gapPolicy: "autoFill",
    windows: [{ start: "11:00", end: "12:00" }],
  });
  const later = await draft("later");
  await t.mutation(api.posts.queue, { secret, id: later });
  await t.mutation(api.posts.updateSettings, {
    secret,
    ...settings,
    gapPolicy: "autoFill",
  });
  await t.mutation(api.posts.unqueue, { secret, id: removed });
  expect(await get(later)).toMatchObject({
    pinned: false,
    status: { kind: "queued", at: wib("2026-10-19T06:00:00") },
  });
});

test("the scheduler holds blocked posts without sending a Threads request", async () => {
  const { t, draft, get, block } = await setup("autoFill");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const ids = [await draft("first"), await draft("second")];
  for (const id of ids) await t.mutation(api.posts.queue, { secret, id });
  await block();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    (await Promise.all(ids.map(get))).map((post) => post?.status.kind),
  ).toEqual(["held", "held"]);
  expect(fetch).not.toHaveBeenCalled();
});
