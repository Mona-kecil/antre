import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  connectThreads,
  ownerTest,
} from "./testing/workspace.test-support";

const wib = (time: string) => Date.parse(`${time}+07:00`);
const day = 86_400_000;
const settings = {
  windows: [{ start: "06:00", end: "12:00" }],
  intervalMinutes: 30,
  timeZone: "Asia/Jakarta" as const,
  gapPolicy: "keepTimes" as const,
};

async function setup(gapPolicy: "autoFill" | "keepTimes" = "keepTimes") {
  const t = await ownerTest();
  const account = {
    threadsUserId: "owner",
    username: "owner",
    accessToken: "token",
    tokenExpiresAt: Date.now() + 60 * day,
  };
  await connectThreads(t, { ...account });
  await t.mutation(api.posts.updateSettings, {
    ...settings,
    gapPolicy,
  });
  const draft = (text: string) =>
    t.mutation(api.posts.createDraft, {
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
    const at = await t.mutation(api.posts.queue, { id });
    await block(expired);
    vi.setSystemTime(at);
    await fire(id);
    expect(await get(id)).toMatchObject({
      status: { kind: "held", at, heldAt: at },
      pinned: false,
    });
    const account = await t.query(api.account.current, {});
    expect(account).toMatchObject({ needsReconnect: true });
    expect(await t.query(api.posts.listQueue, {})).toMatchObject([
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
      await t.query(api.library.page, { view: "scheduled" }),
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
      await t.mutation(api.posts.queue, { id });
    }
    const pin = await draft("pinned");
    const pinAt = wib("2026-10-19T08:00:00");
    await t.mutation(api.posts.queue, { id: pin, at: pinAt });
    // A collision with the first held post's next-day clock time.
    const nextDayPin = await draft("next day pin");
    await t.mutation(api.posts.queue, {
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
    await connectThreads(t, {
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
    await connectThreads(t, {
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
        id,
        ...(text === "pin" ? { at: wib("2026-10-19T07:00:00") } : {}),
      });
    }
    const before = await Promise.all(ids.slice(1).map(get));
    await t.mutation(api.posts[operation], { id: ids[0] });
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
  const oldAt = await t.mutation(api.posts.queue, { id: first });
  const pinnedAt = wib("2026-10-19T07:00:00");
  await t.mutation(api.posts.queue, { id: second, at: pinnedAt });
  const before = await get(first);
  if (before?.status.kind !== "queued") throw new Error("Expected queued post");
  const oldJob = before.status.jobId;
  const generation = before.status.generation;
  await expect(
    t.mutation(api.posts.move, { id: first, at: Date.now() }),
  ).rejects.toThrow("future");
  await expect(
    t.mutation(api.posts.move, { id: first, at: pinnedAt }),
  ).rejects.toThrow("already taken");
  const movedAt = wib("2026-10-19T08:00:00");
  await t.mutation(api.posts.move, { id: first, at: movedAt });
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
  expect(await t.mutation(api.posts.move, { id: first })).toBe(oldAt);
  const firstBeforeSwap = await get(first);
  const secondBeforeSwap = await get(second);
  await t.mutation(api.posts.swap, { id: first, otherId: second });
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
    t.mutation(api.posts.swap, { id: first, otherId: first }),
  ).rejects.toThrow("different");
});

test("settings sort and validate windows; slots span windows and WIB days without moving existing jobs", async () => {
  const { t, draft, get } = await setup();
  const existing = await draft("existing");
  await t.mutation(api.posts.queue, { id: existing });
  const before = await get(existing);
  const windows = [
    { start: "13:00", end: "13:30" },
    { start: "06:00", end: "06:30" },
  ];
  const value = await t.mutation(api.posts.updateSettings, {
    ...settings,
    windows,
  });
  expect(value.windows).toEqual([...windows].reverse());
  expect(await t.query(api.posts.getSettings, {})).toEqual(value);
  expect(await get(existing)).toEqual(before);
  const at = [];
  for (const text of ["a", "b", "c", "d"]) {
    at.push(await t.mutation(api.posts.queue, { id: await draft(text) }));
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
      t.mutation(api.posts.updateSettings, { ...settings, windows }),
    ).rejects.toThrow();
  }
  for (const intervalMinutes of [4, 241, 5.5]) {
    await expect(
      t.mutation(api.posts.updateSettings, {
        ...settings,
        intervalMinutes,
      }),
    ).rejects.toThrow("integer between 5 and 240");
  }
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
    await t.mutation(api.posts.queue, { id });
  }
  await t.mutation(api.posts.unqueue, { id: ids[2] });
  await t.mutation(api.posts.updateSettings, {
    ...settings,
    gapPolicy: "autoFill",
  });
  vi.setSystemTime(wib("2026-10-19T08:00:00"));
  await t.mutation(api.posts.unqueue, { id: ids[0] });
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
    id: removed,
    at: wib("2026-10-19T10:00:00"),
  });
  await t.mutation(api.posts.updateSettings, {
    ...settings,
    gapPolicy: "autoFill",
    windows: [{ start: "11:00", end: "12:00" }],
  });
  const later = await draft("later");
  await t.mutation(api.posts.queue, { id: later });
  await t.mutation(api.posts.updateSettings, {
    ...settings,
    gapPolicy: "autoFill",
  });
  await t.mutation(api.posts.unqueue, { id: removed });
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
  for (const id of ids) await t.mutation(api.posts.queue, { id });
  await block();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    (await Promise.all(ids.map(get))).map((post) => post?.status.kind),
  ).toEqual(["held", "held"]);
  expect(fetch).not.toHaveBeenCalled();
});

test("schedule returns one WIB day, a day strip, held count, and the next free slot", async () => {
  const { t, draft } = await setup();
  const first = await draft("first");
  const second = await draft("second");
  const tomorrow = await draft("tomorrow");
  await t.mutation(api.posts.queue, { id: first });
  await t.mutation(api.posts.queue, { id: second });
  await t.mutation(api.posts.queue, {
    id: tomorrow,
    at: wib("2026-10-20T07:15:00"),
  });
  const today = wib("2026-10-19T00:00:00");
  const view = await t.query(api.posts.schedule, {
    from: today,
    days: 7,
    day: today,
  });
  expect(view.counts).toEqual([2, 1, 0, 0, 0, 0, 0]);
  expect(view.posts.map((post) => post.parts[0].text)).toEqual([
    "first",
    "second",
  ]);
  expect(view.posts[0]).toMatchObject({
    at: wib("2026-10-19T06:00:00"),
    pinned: false,
  });
  expect(view).toMatchObject({
    held: 0,
    nextSlot: wib("2026-10-19T07:00:00"),
    settings: { intervalMinutes: 30 },
    account: { username: "owner", needsReconnect: false },
  });
  await expect(
    t.query(api.posts.schedule, { from: today, days: 0, day: today }),
  ).rejects.toThrow("Days must be");
});
