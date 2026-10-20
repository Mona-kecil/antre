import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { MAX_IMAGE_BYTES } from "./lib/media";
import { storeTestImage } from "./testing/storage";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const secret = "test-secret";

async function setup() {
  const t = convexTest(schema, modules);
  const requests: {
    method: string;
    url: string;
    path: string;
    params: URLSearchParams;
    at: number;
  }[] = [];
  const containers = new Map<
    string,
    {
      text: string;
      replied_to?: { id: string };
      statusChecks: number;
    }
  >();
  const live: {
    id: string;
    text: string;
    replied_to?: { id: string };
    timestamp: string;
  }[] = [];
  let failure:
    | {
        text: string;
        mode:
          | "reject"
          | "timeout"
          | "token"
          | "processing"
          | "server"
          | "rate"
          | "network";
        remaining: number;
      }
    | undefined;
  let refreshError: number | "network" | undefined;
  let verificationError: number | "network" | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (
        url.origin !== "https://graph.threads.net" ||
        (!url.pathname.startsWith("/v1.0/") &&
          url.pathname !== "/refresh_access_token")
      )
        throw new Error("Unexpected Threads URL");
      const method = init?.method ?? "GET";
      const params =
        method === "GET"
          ? url.searchParams
          : new URLSearchParams(String(init?.body));
      const path =
        url.pathname === "/refresh_access_token"
          ? "refresh_access_token"
          : url.pathname.slice("/v1.0/".length);
      requests.push({ method, url: url.href, path, params, at: Date.now() });
      const authorization = new Headers(init?.headers).get("Authorization");
      expect(authorization).toMatch(/^Bearer /);
      if (path === "refresh_access_token") {
        expect(method).toBe("GET");
        expect(url.href).toBe(
          `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(authorization?.slice(7) ?? "")}`,
        );
        if (refreshError === "network") throw new Error("Connection reset");
        if (refreshError !== undefined)
          return Response.json(
            { error: { message: "Refresh rejected", code: refreshError } },
            { status: 400 },
          );
        return Response.json({
          access_token: "refreshed-test-token",
          expires_in: 5_184_000,
        });
      }
      if (method === "GET" && path === "me") {
        expect(params.get("fields")).toBe("id");
        if (verificationError === "network")
          throw new Error("Connection reset");
        if (verificationError !== undefined)
          return Response.json(
            {
              error: {
                message: "Verification rejected",
                code: verificationError,
              },
            },
            { status: 400 },
          );
        return Response.json({ id: "user" });
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
          statusChecks: 0,
          ...(parent ? { replied_to: { id: parent } } : {}),
        });
        return Response.json({ id });
      }
      const statusContainer = containers.get(path);
      if (method === "GET" && statusContainer) {
        expect(params.get("fields")).toBe("status,error_message");
        statusContainer.statusChecks++;
        if (
          failure?.text === statusContainer.text &&
          failure.mode === "processing"
        )
          return Response.json({
            status: "ERROR",
            error_message: "Media processing failed",
          });
        return Response.json({
          status:
            statusContainer.statusChecks === 1 ? "IN_PROGRESS" : "FINISHED",
        });
      }
      if (method === "POST" && path === "user/threads_publish") {
        const container = containers.get(params.get("creation_id") ?? "");
        if (!container) throw new Error("Unknown container");
        if (container.statusChecks < 2)
          return Response.json(
            {
              error: {
                message: "The requested resource does not exist",
                code: 24,
              },
            },
            { status: 400 },
          );
        const mode =
          failure?.text === container.text ? failure.mode : undefined;
        if (mode && failure && --failure.remaining === 0) failure = undefined;
        if (mode === "network") throw new Error("Connection reset");
        if (mode === "server" || mode === "rate")
          return Response.json(
            { error: { message: "Try again", code: mode === "rate" ? 4 : 2 } },
            { status: mode === "rate" ? 429 : 503 },
          );
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
        live.push({
          id,
          text: container.text,
          replied_to: container.replied_to,
          timestamp: new Date().toISOString(),
        });
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
      tokenExpiresAt: Date.now() + 59 * 86_400_000,
      needsReconnect: false,
    });
  });
  return {
    t,
    block: () =>
      t.run(async (ctx) => {
        const account = await ctx.db.query("account").unique();
        if (!account) throw new Error("Missing account");
        await ctx.db.patch(account._id, { needsReconnect: true });
      }),
    reconnect: () =>
      t.mutation(api.account.connect, {
        secret,
        threadsUserId: "user",
        username: "owner",
        accessToken: "new-token",
        tokenExpiresAt: Date.now() + 60 * 86_400_000,
      }),
    fake: {
      requests,
      live,
      fail(
        text: string,
        mode: NonNullable<typeof failure>["mode"],
        remaining = 1,
      ) {
        failure = { text, mode, remaining };
      },
      failRefresh(code: number | "network" = 190) {
        refreshError = code;
      },
      failVerification(code: number | "network") {
        verificationError = code;
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

test("validates stored images when creating and updating drafts and returns image previews", async () => {
  const t = convexTest(schema, modules);
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );
  const store = (blob: Blob) => t.run((ctx) => storeTestImage(ctx, blob));
  const imageId = await store(new Blob([png], { type: "image/png" }));
  const id = await t.mutation(api.posts.createDraft, {
    secret,
    source: "agent",
    parts: [{ text: "PNG draft", imageId }],
  });
  const preview = await t.query(api.images.preview, { secret, imageId });
  expect(preview).toEqual({
    imageId,
    previewUrl: expect.stringMatching(/^https?:\/\//),
  });
  expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
    {
      _id: id,
      parts: [{ text: "PNG draft", imageId, imageUrl: preview.previewUrl }],
    },
  ]);
  expect(
    await t.query(api.library.searchPosts, { secret, fullParts: true }),
  ).toMatchObject([
    {
      id,
      parts: [{ text: "PNG draft", imageId, imageUrl: preview.previewUrl }],
    },
  ]);
  for (const [blob, message] of [
    [new Blob(["text"], { type: "text/plain" }), "JPEG or PNG"],
    [new Blob([png], { type: "image/webp" }), "JPEG or PNG"],
    [
      new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: "image/png" }),
      "8 MB",
    ],
    [new Blob([], { type: "image/png" }), "1 byte"],
  ] as const) {
    const invalidId = await store(blob);
    await expect(
      t.mutation(api.posts.createDraft, {
        secret,
        source: "agent",
        parts: [{ text: "bad", imageId: invalidId }],
      }),
    ).rejects.toThrow(message);
    await expect(
      t.mutation(api.posts.updateDraft, {
        secret,
        id,
        parts: [{ text: "bad", imageId: invalidId }],
      }),
    ).rejects.toThrow(message);
  }
  // The size boundary is inclusive, and metadata-only edits leave existing media alone.
  const maximum = await store(
    new Blob([new Uint8Array(MAX_IMAGE_BYTES)], { type: "image/jpeg" }),
  );
  await t.mutation(api.posts.updateDraft, {
    secret,
    id,
    parts: [{ text: "JPEG draft", imageId: maximum }],
  });
  await t.run((ctx) => ctx.storage.delete(maximum));
  await t.mutation(api.posts.updateDraft, {
    secret,
    id,
    meta: { hook: "changed" },
  });
  await expect(
    t.mutation(api.posts.createDraft, {
      secret,
      source: "agent",
      parts: [{ text: "deleted", imageId: maximum }],
    }),
  ).rejects.toThrow("Image not found");
  expect(await t.query(api.posts.listQueue, { secret })).toHaveLength(1);
});

test("defaults to Marketing and publishes a chosen topic only on the first part", async () => {
  const { t, fake } = await setup();
  const imageId = await t.run((ctx) =>
    storeTestImage(ctx, new Blob(["image"], { type: "image/png" })),
  );
  for (const [index, topicTag] of [
    undefined,
    "  Digital Marketing  ",
    "",
  ].entries()) {
    const expected = topicTag === undefined ? "Marketing" : topicTag.trim();
    const text = `tagged root ${index}`;
    const id = await t.mutation(api.posts.createDraft, {
      secret,
      source: "agent",
      parts: [
        { text, ...(index === 1 ? { imageId } : {}) },
        { text: `tagged reply ${index}` },
      ],
      ...(topicTag === undefined ? {} : { topicTag }),
      meta: { topic: "T01" },
    });
    const { posts } = await t.query(api.posts.getPosts, { secret, ids: [id] });
    expect(posts[0]?.topicTag).toBe(expected || undefined);
    expect(posts[0]?.meta.topic).toBe("T01");
    await t.mutation(api.posts.queue, { secret, id, at: Date.now() + 1_000 });
    const plan = await t.query(api.posts.schedule, {
      secret,
      from: Date.now(),
      day: Date.now(),
      days: 1,
    });
    expect(plan.posts.find((post) => post.id === id)?.topicTag).toBe(
      expected || undefined,
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const request = fake.requests.find(
      ({ method, path, params }) =>
        method === "POST" &&
        path === "user/threads" &&
        params.get("text") === text,
    );
    expect(request?.params.get("topic_tag")).toBe(expected || null);
    expect(request?.params.get("media_type")).toBe(
      index === 1 ? "IMAGE" : "TEXT",
    );
    const reply = fake.requests.find(
      ({ method, path, params }) =>
        method === "POST" &&
        path === "user/threads" &&
        params.get("text") === `tagged reply ${index}`,
    );
    expect(reply?.params.get("topic_tag")).toBeNull();
    expect(
      (
        await t.query(api.library.page, { secret, view: "published" })
      ).items.find((post) => post.id === id)?.topicTag,
    ).toBe(expected || undefined);
    expect(
      (await t.query(api.library.searchPosts, { secret, text })).find(
        (post) => post.id === id,
      )?.topicTag,
    ).toBe(expected || undefined);
  }
});

test("validates, preserves and clears the public topic independently of internal labels", async () => {
  const { t } = await setup();
  const id = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [{ text: "topic edits" }],
    meta: { topic: "T15" },
  });
  const read = async () =>
    (await t.query(api.posts.getPosts, { secret, ids: [id] })).posts[0];
  await t.mutation(api.posts.updateDraft, {
    secret,
    id,
    meta: { topic: "T06" },
  });
  expect((await read())?.topicTag).toBe("Marketing");
  for (const topicTag of ["a".repeat(51), "Ads & sales", "Meta.ads"]) {
    await expect(
      t.mutation(api.posts.createDraft, {
        secret,
        source: "agent",
        parts: [{ text: "invalid topic" }],
        topicTag,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.posts.updateDraft, { secret, id, topicTag }),
    ).rejects.toThrow();
  }
  await t.mutation(api.posts.updateDraft, {
    secret,
    id,
    topicTag: "😀".repeat(50),
  });
  expect((await read())?.topicTag).toBe("😀".repeat(50));
  await t.mutation(api.posts.updateDraft, { secret, id, topicTag: "   " });
  expect((await read())?.topicTag).toBeUndefined();
  await t.mutation(api.posts.updateDraft, {
    secret,
    id,
    parts: [{ text: "new text" }],
  });
  expect((await read())?.topicTag).toBeUndefined();
  expect((await read())?.meta.topic).toBe("T06");
});

test("sets topics atomically on drafts and queued posts without moving their slots", async () => {
  const { t } = await setup();
  const ids = await Promise.all(
    ["draft", "queued", "published"].map((text) =>
      t.mutation(api.posts.createDraft, {
        secret,
        source: "agent",
        parts: [{ text }],
      }),
    ),
  );
  const at = await t.mutation(api.posts.queue, { secret, id: ids[1] });
  expect(
    await t.mutation(api.posts.setTopicTag, {
      secret,
      ids: [ids[0], ids[1], ids[0]],
      topicTag: "  Ecommerce  ",
    }),
  ).toEqual({ updated: 2 });
  const read = async () =>
    (await t.query(api.posts.getPosts, { secret, ids })).posts;
  expect((await read()).slice(0, 2).map((post) => post?.topicTag)).toEqual([
    "Ecommerce",
    "Ecommerce",
  ]);
  expect((await read())[1]?.at).toBe(at);
  await t.run((ctx) =>
    ctx.db.patch(ids[2], {
      publishedIds: ["already-live"],
      status: { kind: "failed", at: Date.now(), error: "reply failed" },
    }),
  );
  await expect(
    t.mutation(api.posts.setTopicTag, { secret, ids, topicTag: "Different" }),
  ).rejects.toThrow("before publishing");
  expect((await read()).slice(0, 2).map((post) => post?.topicTag)).toEqual([
    "Ecommerce",
    "Ecommerce",
  ]);
  await expect(
    t.mutation(api.posts.updateDraft, {
      secret,
      id: ids[2],
      topicTag: "Different",
    }),
  ).rejects.toThrow("published first post");
  await expect(
    t.mutation(api.posts.setTopicTag, {
      secret,
      ids: [],
      topicTag: "Marketing",
    }),
  ).rejects.toThrow("1 and 100");
  await expect(
    t.mutation(api.posts.setTopicTag, {
      secret,
      ids: [ids[0]],
      topicTag: "A&B",
    }),
  ).rejects.toThrow("ampersands");
  await t.mutation(api.posts.setTopicTag, {
    secret,
    ids: [ids[0], ids[1]],
    topicTag: "",
  });
  expect((await read()).slice(0, 2).map((post) => post?.topicTag)).toEqual([
    undefined,
    undefined,
  ]);
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
      vi.advanceTimersByTime(Math.max(1_000, slots[index] - Date.now())),
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
  const imageId = await t.run((ctx) => storeTestImage(ctx, image));
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

test("marks a post failed with Meta's container processing error", async () => {
  const { t, fake } = await setup();
  fake.fail("broken image", "processing");
  const id = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [{ text: "broken image" }],
  });
  await t.mutation(api.posts.publishNow, { secret, id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
    {
      publishedIds: [],
      status: { kind: "failed", error: "Media processing failed" },
    },
  ]);
  expect(fake.live).toHaveLength(0);
  expect(
    fake.requests.some(({ path }) => path === "user/threads_publish"),
  ).toBe(false);
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
    if (mode === "reject") {
      expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
        {
          publishedIds: ["post-1"],
          status: { kind: "failed", error: "Part rejected" },
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
    }
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

test("code 190 holds a publish, flags reconnect, and a refresh releases it", async () => {
  const { t, fake } = await setup();
  fake.fail("expired", "token");
  fake.failVerification(190);
  const id = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [{ text: "expired" }],
  });
  await t.mutation(api.posts.publishNow, { secret, id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
    { status: { kind: "held", reason: "Invalid access token" }, held: true },
  ]);
  expect(await t.query(api.account.current, { secret })).toMatchObject({
    needsReconnect: true,
  });
  expect(fake.requests.filter(({ path }) => path === "me")).toMatchObject([
    { url: "https://graph.threads.net/v1.0/me?fields=id" },
  ]);
  await t.action(internal.publishing.refreshToken, {});
  expect(await t.query(api.account.current, { secret })).toMatchObject({
    needsReconnect: false,
  });
  expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
    { status: { kind: "queued", retry: false } },
  ]);
  expect(
    fake.requests.find(({ path }) => path === "refresh_access_token")?.url,
  ).toBe(
    "https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=test-access-token",
  );
  expect(
    fake.requests
      .find(({ path }) => path === "refresh_access_token")
      ?.params.get("grant_type"),
  ).toBe("th_refresh_token");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
    status: { kind: "published" },
  });
  expect(
    fake.requests.filter(
      ({ method, path }) =>
        method === "GET" && ["user/threads", "me/replies"].includes(path),
    ),
  ).toEqual([]);
  vi.setSystemTime(Date.now() + 86_400_000);
  fake.failRefresh();
  fake.failVerification(190);
  await t.action(internal.publishing.refreshToken, {});
  expect(await t.query(api.account.current, { secret })).toMatchObject({
    needsReconnect: true,
    lastRefreshError: "Refresh rejected",
    lastRefreshErrorAt: Date.now(),
  });
});

test("a stuck publisher resumes with the same recovery checks as a retry", async () => {
  const { t, fake } = await setup();
  const id = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [{ text: "stuck" }],
  });
  await t.mutation(api.posts.publishNow, { secret, id });
  vi.setSystemTime(Date.now() + 15 * 60_000 + 1);
  await t.mutation(internal.publishing.sweepStuck, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
    { status: { kind: "published" } },
  ]);
  expect(fake.live.map(({ text }) => text)).toEqual(["stuck"]);
  expect(
    fake.requests.some(
      ({ method, path }) => method === "GET" && path === "user/threads",
    ),
  ).toBe(true);
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

test("tokens younger than 24 hours skip refresh, then refresh at 24 hours", async () => {
  const { t, fake } = await setup();
  await t.run(async (ctx) => {
    const account = await ctx.db.query("account").unique();
    if (!account) throw new Error("Missing account");
    await ctx.db.patch(account._id, {
      tokenExpiresAt: Date.now() + 60 * 86_400_000,
    });
  });
  const before = await t.query(internal.publishing.getAccount, {});
  await t.action(internal.publishing.refreshToken, {});
  vi.setSystemTime(Date.now() + 86_400_000 - 1);
  await t.action(internal.publishing.refreshToken, {});
  expect(fake.requests).toEqual([]);
  expect(await t.query(internal.publishing.getAccount, {})).toEqual(before);
  vi.setSystemTime(Date.now() + 1);
  await t.action(internal.publishing.refreshToken, {});
  expect(fake.requests.map(({ path }) => path)).toEqual([
    "refresh_access_token",
  ]);
  expect(await t.query(internal.publishing.getAccount, {})).toMatchObject({
    accessToken: "refreshed-test-token",
    needsReconnect: false,
  });
});

test.each([1, 190, "network"] as const)(
  "refresh failure %s keeps a valid token usable",
  async (failure) => {
    const { t, fake } = await setup();
    fake.failRefresh(failure);
    await t.action(internal.publishing.refreshToken, {});
    expect(await t.query(internal.publishing.getAccount, {})).toMatchObject({
      accessToken: "test-access-token",
      needsReconnect: false,
      lastRefreshError:
        failure === "network" ? "Connection reset" : "Refresh rejected",
      lastRefreshErrorAt: Date.now(),
    });
    expect(fake.requests.map(({ path }) => path)).toEqual(
      failure === 190
        ? ["refresh_access_token", "me"]
        : ["refresh_access_token"],
    );
    const id = await t.mutation(api.posts.createDraft, {
      secret,
      source: "web",
      parts: [{ text: "still works" }],
    });
    await t.mutation(api.posts.publishNow, { secret, id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fake.live.map(({ text }) => text)).toEqual(["still works"]);
    const refresh = {
      lastRefreshError:
        failure === "network" ? "Connection reset" : "Refresh rejected",
      lastRefreshErrorAt: expect.any(Number),
    };
    expect(await t.query(api.posts.listQueue, { secret })).toMatchObject([
      { account: refresh },
    ]);
    expect(
      await t.query(api.library.page, { secret, view: "published" }),
    ).toMatchObject({ account: refresh });
  },
);

test.each([190, 1, "network"] as const)(
  "refresh 190 and verification failure %s require reconnect only for verification 190",
  async (failure) => {
    const { t, fake } = await setup();
    fake.failRefresh(190);
    fake.failVerification(failure);
    await t.action(internal.publishing.refreshToken, {});
    expect(fake.requests.map(({ path }) => path)).toEqual([
      "refresh_access_token",
      "me",
    ]);
    expect(await t.query(internal.publishing.getAccount, {})).toMatchObject({
      accessToken: "test-access-token",
      needsReconnect: failure === 190,
      lastRefreshError: "Refresh rejected",
      lastRefreshErrorAt: Date.now(),
    });
  },
);

test.each(["server", "rate", "network"] as const)(
  "retries a transient %s failure after backoff then succeeds",
  async (mode) => {
    const { t, fake } = await setup();
    fake.fail("recover", mode);
    const id = await t.mutation(api.posts.createDraft, {
      secret,
      source: "web",
      parts: [{ text: "recover" }],
    });
    await t.mutation(api.posts.publishNow, { secret, id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
      status: { kind: "published" },
    });
    expect(fake.live.map(({ text }) => text)).toEqual(["recover"]);
    const publishes = fake.requests.filter(
      ({ path }) => path === "user/threads_publish",
    );
    expect(publishes).toHaveLength(2);
    expect(publishes[1].at - publishes[0].at).toBeGreaterThanOrEqual(60_000);
    expect(
      fake.requests.some(
        ({ method, path }) => method === "GET" && path === "user/threads",
      ),
    ).toBe(true);
  },
);

test("transient retries stop after three backoffs", async () => {
  const { t, fake } = await setup();
  fake.fail("unavailable", "server", 10);
  const id = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [{ text: "unavailable" }],
  });
  await t.mutation(api.posts.publishNow, { secret, id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
    status: { kind: "failed", error: "Try again" },
  });
  const publishes = fake.requests.filter(
    ({ path }) => path === "user/threads_publish",
  );
  expect(publishes).toHaveLength(4);
  for (const [index, minimum] of [60_000, 300_000, 900_000].entries()) {
    expect(
      publishes[index + 1].at - publishes[index].at,
    ).toBeGreaterThanOrEqual(minimum);
  }
  expect(fake.live).toHaveLength(0);
});

test("refresh failures flag expired tokens and stale refresh results cannot replace a reconnect", async () => {
  const { t, fake } = await setup();
  await t.run(async (ctx) => {
    const account = await ctx.db.query("account").unique();
    if (!account) throw new Error("Missing account");
    await ctx.db.patch(account._id, { tokenExpiresAt: Date.now() - 1 });
  });
  fake.failRefresh(1);
  await t.action(internal.publishing.refreshToken, {});
  expect(await t.query(api.account.current, { secret })).toMatchObject({
    needsReconnect: true,
    lastRefreshError: "Refresh rejected",
  });
  await t.mutation(api.account.connect, {
    secret,
    threadsUserId: "user",
    username: "owner",
    accessToken: "new-token",
    tokenExpiresAt: Date.now() + 86_400_000,
  });
  await t.mutation(internal.publishing.saveToken, {
    expectedToken: "test-access-token",
    error: "Old request",
    invalid: true,
  });
  await t.mutation(internal.publishing.saveToken, {
    expectedToken: "test-access-token",
    token: { accessToken: "old-refreshed", tokenExpiresAt: Date.now() + 10 },
  });
  expect(await t.query(internal.publishing.getAccount, {})).toMatchObject({
    accessToken: "new-token",
    needsReconnect: false,
  });
  expect(await t.query(api.account.current, { secret })).toMatchObject({
    lastRefreshError: null,
    lastRefreshErrorAt: null,
  });
});

test("moving a fresh queued post does not treat an older identical post as its own publication", async () => {
  const { t, fake } = await setup();
  const first = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [{ text: "same text" }],
  });
  await t.mutation(api.posts.publishNow, { secret, id: first });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const second = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [{ text: "same text" }],
  });
  await t.mutation(api.posts.queue, { secret, id: second });
  await t.mutation(api.posts.move, {
    secret,
    id: second,
    at: Date.now() + 60_000,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fake.live.map(({ text }) => text)).toEqual(["same text", "same text"]);
  expect(
    await t.query(internal.publishing.getPost, { id: second }),
  ).toMatchObject({ publishedIds: ["post-2"], status: { kind: "published" } });
});

test("a legacy queued retry keeps recovery checks through a move and publish-now", async () => {
  const { t, fake } = await setup();
  const id = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [{ text: "ambiguous publish" }],
  });
  // Threads accepted the root, but the old worker lost the response.
  fake.live.push({
    id: "post-1",
    text: "ambiguous publish",
    timestamp: new Date().toISOString(),
  });
  await t.run((ctx) =>
    ctx.db.patch(id, {
      status: {
        kind: "failed",
        at: Date.now(),
        error: "Publish response timed out",
      },
    }),
  );
  await t.mutation(api.posts.queue, { secret, id });
  await t.run(async (ctx) => {
    const post = await ctx.db.get(id);
    if (post?.status.kind !== "queued") throw new Error("Expected queued post");
    const { retry, ...legacyStatus } = post.status;
    expect(retry).toBe(true);
    await ctx.db.patch(id, { status: legacyStatus });
  });
  await t.mutation(api.posts.move, { secret, id, at: Date.now() + 60_000 });
  expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
    status: { kind: "queued", retry: true },
  });
  await t.mutation(api.posts.publishNow, { secret, id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fake.live).toHaveLength(1);
  expect(fake.requests.some(({ method }) => method === "POST")).toBe(false);
  expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
    publishedIds: ["post-1"],
    status: { kind: "published" },
  });
});

test.each(["fire", "publishNow"] as const)(
  "a fresh post held by %s publishes its own copy after release without recovery",
  async (entry) => {
    const { t, fake, block, reconnect } = await setup();
    const id = await t.mutation(api.posts.createDraft, {
      secret,
      source: "web",
      parts: [{ text: "same text" }],
    });
    fake.live.push({
      id: "post-1",
      text: "same text",
      timestamp: new Date().toISOString(),
    });
    await block();
    if (entry === "fire") await t.mutation(api.posts.queue, { secret, id });
    else await t.mutation(api.posts.publishNow, { secret, id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
      status: { kind: "held", retry: false },
    });
    expect(fake.requests).toEqual([]);
    await reconnect();
    expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
      status: { kind: "queued", retry: false },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
      status: { kind: "published" },
      publishedIds: ["post-2"],
    });
    expect(fake.live.map(({ text }) => text)).toEqual([
      "same text",
      "same text",
    ]);
    expect(
      fake.requests.filter(
        ({ method, path }) =>
          method === "GET" &&
          ["user/threads", "me/replies", "me"].includes(path),
      ),
    ).toEqual([]);
  },
);

test.each(["fire", "publishNow"] as const)(
  "a recovery retry held by %s keeps recovery after release",
  async (entry) => {
    const { t, fake, block, reconnect } = await setup();
    const id = await t.mutation(api.posts.createDraft, {
      secret,
      source: "web",
      parts: [{ text: "lost response" }],
    });
    fake.live.push({
      id: "post-1",
      text: "lost response",
      timestamp: new Date().toISOString(),
    });
    await t.run((ctx) =>
      ctx.db.patch(id, {
        status: { kind: "failed", at: Date.now(), error: "Lost response" },
      }),
    );
    await t.mutation(api.posts.queue, { secret, id });
    await block();
    if (entry === "publishNow")
      await t.mutation(api.posts.publishNow, { secret, id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
      status: { kind: "held", retry: true },
    });
    expect(fake.requests).toEqual([]);
    await reconnect();
    expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
      status: { kind: "queued", retry: true },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
      status: { kind: "published" },
      publishedIds: ["post-1"],
    });
    expect(fake.requests.some(({ path }) => path === "user/threads")).toBe(
      true,
    );
    expect(fake.requests.some(({ method }) => method === "POST")).toBe(false);
    expect(fake.live).toHaveLength(1);
  },
);

test.each([undefined, false])(
  "a held post with published IDs recovers even with retry=%s",
  async (retry) => {
    const { t, fake, reconnect } = await setup();
    const id = await t.mutation(api.posts.createDraft, {
      secret,
      source: "web",
      parts: [{ text: "root" }, { text: "reply" }],
    });
    fake.live.push(
      { id: "post-1", text: "root", timestamp: new Date().toISOString() },
      {
        id: "post-2",
        text: "reply",
        replied_to: { id: "post-1" },
        timestamp: new Date().toISOString(),
      },
    );
    await t.run((ctx) =>
      ctx.db.patch(id, {
        publishedIds: ["post-1"],
        status: {
          kind: "held",
          at: Date.now(),
          heldAt: Date.now(),
          reason: "Auth rejected",
          retry,
        },
      }),
    );
    await reconnect();
    expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
      status: { kind: "queued", retry: true },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
      status: { kind: "published" },
      publishedIds: ["post-1", "post-2"],
    });
    expect(fake.requests.some(({ path }) => path === "me/replies")).toBe(true);
    expect(fake.requests.some(({ method }) => method === "POST")).toBe(false);
  },
);

test.each([undefined, 1, "network"] as const)(
  "publish 190 with verification %s schedules a retry without reconnect",
  async (verification) => {
    const { t, fake } = await setup();
    fake.fail("still valid", "token");
    if (verification !== undefined) fake.failVerification(verification);
    const id = await t.mutation(api.posts.createDraft, {
      secret,
      source: "web",
      parts: [{ text: "still valid" }],
    });
    await t.mutation(api.posts.publishNow, { secret, id });
    await vi.advanceTimersByTimeAsync(5_000);
    await t.finishInProgressScheduledFunctions();
    expect(await t.query(api.account.current, { secret })).toMatchObject({
      needsReconnect: false,
    });
    const post = await t.query(internal.publishing.getPost, { id });
    expect(post).toMatchObject({
      status: { kind: "publishing", attempt: 1, retryAt: expect.any(Number) },
    });
    if (post?.status.kind !== "publishing" || !post.status.retryJobId)
      throw new Error("Expected scheduled retry");
    const retryJobId = post.status.retryJobId;
    expect(await t.run((ctx) => ctx.db.system.get(retryJobId))).toMatchObject({
      state: { kind: "pending" },
    });
    expect(fake.requests.filter(({ path }) => path === "me")).toMatchObject([
      { url: "https://graph.threads.net/v1.0/me?fields=id" },
    ]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
      status: { kind: "published" },
    });
    expect(fake.live.map(({ text }) => text)).toEqual(["still valid"]);
  },
);

test("unconfirmed publish 190 stops after three retries", async () => {
  const { t, fake } = await setup();
  fake.fail("unconfirmed", "token", 10);
  const id = await t.mutation(api.posts.createDraft, {
    secret,
    source: "web",
    parts: [{ text: "unconfirmed" }],
  });
  await t.mutation(api.posts.publishNow, { secret, id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(internal.publishing.getPost, { id })).toMatchObject({
    status: { kind: "failed", error: "Invalid access token" },
  });
  expect(await t.query(api.account.current, { secret })).toMatchObject({
    needsReconnect: false,
  });
  expect(
    fake.requests.filter(({ path }) => path === "user/threads_publish"),
  ).toHaveLength(4);
  expect(fake.requests.filter(({ path }) => path === "me")).toHaveLength(4);
});
