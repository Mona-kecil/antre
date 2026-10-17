import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const secret = "test-secret";

async function setup() {
  const t = convexTest(schema, modules);
  const requests: { method: string; path: string; params: URLSearchParams }[] =
    [];
  const containers = new Map<
    string,
    { text: string; replied_to?: { id: string } }
  >();
  const live: {
    id: string;
    text: string;
    replied_to?: { id: string };
    timestamp: string;
  }[] = [];
  let failure:
    { text: string; mode: "reject" | "timeout" | "token" } | undefined;
  let failRefresh = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (
        url.origin !== "https://graph.threads.net" ||
        !url.pathname.startsWith("/v1.0/")
      )
        throw new Error("Unexpected Threads URL");
      const method = init?.method ?? "GET";
      const params =
        method === "GET"
          ? url.searchParams
          : new URLSearchParams(String(init?.body));
      const path = url.pathname.slice("/v1.0/".length);
      requests.push({ method, path, params });
      expect(new Headers(init?.headers).get("Authorization")).toMatch(
        /^Bearer /,
      );
      if (path === "refresh_access_token") {
        if (failRefresh)
          return Response.json(
            { error: { message: "Refresh rejected", code: 190 } },
            { status: 400 },
          );
        return Response.json({
          access_token: "refreshed-test-token",
          expires_in: 5_184_000,
        });
      }
      if (
        method === "GET" &&
        (path === "user/threads" || path === "me/replies")
      ) {
        return Response.json({
          data: live.filter((item) =>
            path === "me/replies" ? item.replied_to : !item.replied_to,
          ),
        });
      }
      if (method === "POST" && path === "user/threads") {
        const id = `container-${containers.size + 1}`;
        const parent = params.get("reply_to_id");
        containers.set(id, {
          text: params.get("text") ?? "",
          ...(parent ? { replied_to: { id: parent } } : {}),
        });
        return Response.json({ id });
      }
      if (method === "POST" && path === "user/threads_publish") {
        const container = containers.get(params.get("creation_id") ?? "");
        if (!container) throw new Error("Unknown container");
        const mode =
          failure?.text === container.text ? failure.mode : undefined;
        if (mode) failure = undefined;
        if (mode === "reject" || mode === "token") {
          return Response.json(
            {
              error: {
                message:
                  mode === "token" ? "Invalid access token" : "Part rejected",
                code: mode === "token" ? 190 : 1,
              },
            },
            { status: 400 },
          );
        }
        const id = `post-${live.length + 1}`;
        live.push({ id, ...container, timestamp: new Date().toISOString() });
        if (mode === "timeout") throw new Error("Publish response timed out");
        return Response.json({ id });
      }
      if (method === "GET" && live.some(({ id }) => id === path)) {
        return Response.json({
          permalink: `https://www.threads.net/@owner/post/${path}`,
        });
      }
      throw new Error(`Unexpected Threads request: ${method} ${path}`);
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("account", {
      threadsUserId: "user",
      username: "owner",
      accessToken: "test-access-token",
      tokenExpiresAt: Date.now() + 60 * 86_400_000,
      needsReconnect: false,
    });
  });
  return {
    t,
    fake: {
      requests,
      live,
      fail(text: string, mode: NonNullable<typeof failure>["mode"]) {
        failure = { text, mode };
      },
      failRefresh() {
        failRefresh = true;
      },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T04:45:00Z"));
  vi.stubEnv("ANTRE_SECRET", secret);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("queues consecutive WIB slots, spills after noon, and publishes each scheduled post", async () => {
  const { t, fake } = await setup();
  const ids = [];
  for (const text of ["one", "two", "three"]) {
    ids.push(
      await t.mutation(api.posts.createDraft, {
        secret,
        parts: [{ text }],
        source: "agent",
      }),
    );
  }
  const slots: number[] = [];
  for (const id of ids)
    slots.push(await t.mutation(api.posts.queue, { secret, id }));
  expect(slots).toEqual([
    Date.parse("2026-10-18T05:00:00Z"),
    Date.parse("2026-10-18T23:00:00Z"),
    Date.parse("2026-10-18T23:30:00Z"),
  ]);
  expect(fake.requests).toHaveLength(0);
  for (let index = 0; index < slots.length; index++) {
    await t.finishAllScheduledFunctions(() =>
      vi.advanceTimersByTime(Math.max(0, slots[index] - Date.now())),
    );
    const posts = await t.query(api.posts.listQueue, { secret });
    expect(posts[index]).toMatchObject({
      _id: ids[index],
      publishedIds: [`post-${index + 1}`],
      status: {
        kind: "published",
        at: slots[index],
        permalink: `https://www.threads.net/@owner/post/post-${index + 1}`,
      },
    });
    expect(fake.live).toHaveLength(index + 1);
  }
  expect(
    fake.requests.filter(({ path }) => path === "user/threads_publish"),
  ).toHaveLength(3);
});

test("publishes a three-part reply chain with an image from Convex storage", async () => {
  const { t, fake } = await setup();
  const image = new Blob(["image"], { type: "image/png" });
  const imageId = await t.run(async (ctx) => await ctx.storage.store(image));
  const id = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [
      { text: "part 1" },
      { text: "part 2", imageId },
      { text: "part 3" },
    ],
  });
  await t.mutation(api.posts.publishNow, { secret, id });
  await expect(
    t.mutation(api.posts.deletePost, { secret, id }),
  ).rejects.toThrow("publishing");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    fake.live.map(({ text, replied_to }) => ({ text, parent: replied_to?.id })),
  ).toEqual([
    { text: "part 1", parent: undefined },
    { text: "part 2", parent: "post-1" },
    { text: "part 3", parent: "post-2" },
  ]);
  const containers = fake.requests.filter(
    ({ method, path }) => method === "POST" && path === "user/threads",
  );
  expect(containers[1].params.get("media_type")).toBe("IMAGE");
  expect(containers[1].params.get("image_url")).toMatch(/^https?:\/\//);
  expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
    {
      publishedIds: ["post-1", "post-2", "post-3"],
      status: {
        kind: "published",
        permalink: "https://www.threads.net/@owner/post/post-1",
      },
    },
  ]);
});

test.each(["reject", "timeout"] as const)(
  "resumes a partial thread after %s without duplicate parts",
  async (mode) => {
    const { t, fake } = await setup();
    fake.fail("part 2", mode);
    const id = await t.mutation(api.posts.createDraft, {
      secret,
      source: "agent",
      parts: [{ text: "part 1" }, { text: "part 2" }, { text: "part 3" }],
    });
    await t.mutation(api.posts.publishNow, { secret, id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
      {
        publishedIds: ["post-1"],
        status: {
          kind: "failed",
          error:
            mode === "timeout" ? "Publish response timed out" : "Part rejected",
        },
      },
    ]);
    await expect(
      t.mutation(api.posts.updateDraft, {
        secret,
        id,
        parts: [{ text: "changed root" }],
      }),
    ).rejects.toThrow("Published parts");
    await t.mutation(api.posts.retry, { secret, id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fake.live.map(({ text }) => text)).toEqual([
      "part 1",
      "part 2",
      "part 3",
    ]);
    expect(fake.live[2].replied_to).toEqual({ id: "post-2" });
    expect(
      fake.requests.filter(
        ({ method, path, params }) =>
          method === "POST" &&
          path === "user/threads" &&
          params.get("text") === "part 1",
      ),
    ).toHaveLength(1);
    expect(
      fake.requests.filter(
        ({ method, path, params }) =>
          method === "POST" &&
          path === "user/threads" &&
          params.get("text") === "part 2",
      ),
    ).toHaveLength(mode === "timeout" ? 1 : 2);
    expect(fake.requests.some(({ path }) => path === "me/replies")).toBe(true);
    expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
      {
        publishedIds: ["post-1", "post-2", "post-3"],
        status: { kind: "published" },
      },
    ]);
  },
);

test("cancels unqueued and deleted jobs, rejects taken times, and reserves published slots", async () => {
  const { t, fake } = await setup();
  const first = await t.mutation(api.posts.createDraft, {
    secret,
    parts: [{ text: "first" }],
    source: "web",
  });
  const second = await t.mutation(api.posts.createDraft, {
    secret,
    parts: [{ text: "second" }],
    source: "web",
  });
  const third = await t.mutation(api.posts.createDraft, {
    secret,
    parts: [{ text: "third" }],
    source: "web",
  });
  const at = await t.mutation(api.posts.queue, { secret, id: first });
  await expect(
    t.mutation(api.posts.queue, { secret, id: second, at }),
  ).rejects.toThrow("already taken");
  const queuedFirst = (await t.query(api.posts.listQueue, { secret })).find(
    ({ _id }) => _id === first,
  );
  if (queuedFirst?.status.kind !== "queued")
    throw new Error("Expected queued post");
  const firstJob = queuedFirst.status.jobId;
  await t.mutation(api.posts.unqueue, { secret, id: first });
  expect(
    await t.run(async (ctx) => (await ctx.db.system.get(firstJob))?.state.kind),
  ).toBe("canceled");
  await t.mutation(api.posts.queue, { secret, id: second, at });
  const queuedSecond = (await t.query(api.posts.listQueue, { secret })).find(
    ({ _id }) => _id === second,
  );
  if (queuedSecond?.status.kind !== "queued")
    throw new Error("Expected queued post");
  const secondJob = queuedSecond.status.jobId;
  await t.mutation(api.posts.deletePost, { secret, id: second });
  expect(
    await t.run(
      async (ctx) => (await ctx.db.system.get(secondJob))?.state.kind,
    ),
  ).toBe("canceled");
  await t.mutation(api.posts.queue, { secret, id: third, at });
  await t.mutation(api.posts.publishNow, { secret, id: third });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.mutation(internal.posts.fire, { id: first, retry: false });
  expect(fake.live.map(({ text }) => text)).toEqual(["third"]);
  expect(await t.query(api.posts.listQueue, { secret })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ _id: first, status: { kind: "draft" } }),
      expect.objectContaining({
        _id: third,
        status: expect.objectContaining({ kind: "published" }),
      }),
    ]),
  );
  await t.run(async (ctx) => {
    await ctx.db.patch(third, {
      status: {
        kind: "published",
        at,
        permalink: "https://www.threads.net/post/third",
      },
    });
  });
  vi.setSystemTime(at - 1);
  await expect(
    t.mutation(api.posts.queue, { secret, id: first, at }),
  ).rejects.toThrow("already taken");
});

test("flags token error 190, sweeps a stuck publisher, and refreshes or flags the token", async () => {
  const { t, fake } = await setup();
  fake.fail("expired", "token");
  const id = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [{ text: "expired" }],
  });
  await t.mutation(api.posts.publishNow, { secret, id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
    { status: { kind: "failed", error: "Invalid access token" } },
  ]);
  expect(
    await t.run(async (ctx) => await ctx.db.query("account").unique()),
  ).toMatchObject({ needsReconnect: true });
  await t.action(internal.publishing.refreshToken, {});
  expect(
    await t.run(async (ctx) => await ctx.db.query("account").unique()),
  ).toMatchObject({
    accessToken: "refreshed-test-token",
    tokenExpiresAt: Date.now() + 5_184_000_000,
    needsReconnect: false,
  });
  expect(
    fake.requests
      .find(({ path }) => path === "refresh_access_token")
      ?.params.get("grant_type"),
  ).toBe("th_refresh_token");
  const stuck = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [{ text: "stuck" }],
  });
  await t.mutation(api.posts.publishNow, { secret, id: stuck });
  vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
  await t.mutation(internal.publishing.sweepStuck, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    (await t.query(api.posts.listQueue, { secret })).find(
      ({ _id }) => _id === stuck,
    )?.status,
  ).toMatchObject({
    kind: "failed",
    error: expect.stringContaining("10 minutes"),
  });
  expect(fake.live).toHaveLength(0);
  fake.failRefresh();
  await t.action(internal.publishing.refreshToken, {});
  expect(
    await t.run(async (ctx) => await ctx.db.query("account").unique()),
  ).toMatchObject({ needsReconnect: true });
});

test("rejects wrong or unset secrets and invalid parts, and edits only draft or failed posts", async () => {
  const { t, fake } = await setup();
  const input = { parts: [{ text: "draft" }], source: "agent" as const };
  await expect(
    t.mutation(api.posts.createDraft, { ...input, secret: "wrong" }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    t.query(api.posts.listQueue, { secret: "wrong" }),
  ).rejects.toThrow("Unauthorized");
  vi.stubEnv("ANTRE_SECRET", "");
  await expect(
    t.mutation(api.posts.createDraft, { ...input, secret: "" }),
  ).rejects.toThrow("Unauthorized");
  vi.stubEnv("ANTRE_SECRET", secret);
  for (const parts of [
    [],
    [{ text: "" }],
    [{ text: "   " }],
    [{ text: "x".repeat(501) }],
  ]) {
    await expect(
      t.mutation(api.posts.createDraft, { secret, source: "web", parts }),
    ).rejects.toThrow("1–500");
  }
  const id = await t.mutation(api.posts.createDraft, { ...input, secret });
  await expect(
    t.mutation(api.posts.updateDraft, { secret, id, parts: [] }),
  ).rejects.toThrow("1–500");
  await t.mutation(api.posts.updateDraft, {
    secret,
    id,
    parts: [{ text: "edited" }],
    meta: { topic: "T01" },
  });
  await expect(t.mutation(api.posts.retry, { secret, id })).rejects.toThrow(
    "Only failed",
  );
  await expect(
    t.mutation(api.posts.queue, { secret, id, at: Date.now() }),
  ).rejects.toThrow("future");
  await t.mutation(api.posts.queue, { secret, id });
  await expect(
    t.mutation(api.posts.updateDraft, {
      secret,
      id,
      parts: [{ text: "blocked" }],
    }),
  ).rejects.toThrow("Only drafts");
  expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
    {
      parts: [{ text: "edited" }],
      meta: { topic: "T01" },
      status: { kind: "queued" },
    },
  ]);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fake.live.map(({ text }) => text)).toEqual(["edited"]);
});
