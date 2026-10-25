import { convexTest } from "convex-test";
import type { GenericDatabaseWriter, SystemDataModel } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { tokenHash } from "./access";
import schema from "./schema";
import {
  connectLinkedin,
  connectThreads,
} from "./testing/workspace.test-support";
import { cleanupTables } from "./workspaces";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const identity = (subject: string) => ({
  subject,
  issuer: "https://api.workos.com/",
  tokenIdentifier: `https://api.workos.com/|${subject}`,
});
async function setup() {
  const root = convexTest(schema, modules);
  const a = root.withIdentity(identity("a"));
  const b = root.withIdentity(identity("b"));
  const wa = await a.mutation(api.workspaces.ensure, {
    timeZone: "America/New_York",
  });
  const wb = await b.mutation(api.workspaces.ensure, {});
  if (!wa || !wb) throw new Error("Workspace missing");
  return { root, a, b, wa: wa._id, wb: wb._id };
}
const draft = { source: "web" as const, parts: [{ text: "private" }] };
async function asset(
  ctx: MutationCtx & {
    storage: { store(blob: Blob): Promise<Id<"_storage">> };
  },
  workspaceId: Id<"workspaces">,
) {
  const storageId = await ctx.storage.store(
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: "image/png",
    }),
  );
  // convex-test omits MIME metadata. Match the storage service's real fixture shape.
  const system = ctx.db as unknown as GenericDatabaseWriter<SystemDataModel>;
  await system.patch(storageId, { contentType: "image/png" });
  await ctx.db.insert("assets", { workspaceId, storageId });
  return storageId;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
test("empty workspaces are distinct, ensure is idempotent and defaults inherit timezone", async () => {
  const { root, a, b, wa, wb } = await setup();
  expect(wa).not.toBe(wb);
  expect((await a.mutation(api.workspaces.ensure, {}))?._id).toBe(wa);
  expect(await a.query(api.account.current, {})).toBeNull();
  expect(await a.query(api.linkedin.current, {})).toBeNull();
  expect(await a.query(api.posts.getSettings, {})).toMatchObject({
    timeZone: "America/New_York",
  });
  expect(await a.query(api.linkedin.getSettings, {})).toMatchObject({
    timeZone: "America/New_York",
  });
  await a.mutation(api.workspaces.updateTimeZone, {
    timeZone: "Europe/London",
  });
  expect(await a.query(api.linkedin.getSettings, {})).toMatchObject({
    timeZone: "Europe/London",
  });
  expect(await b.query(api.posts.getSettings, {})).toMatchObject({
    timeZone: "Asia/Jakarta",
  });
  expect(await a.query(api.library.page, { view: "drafts" })).toMatchObject({
    total: 0,
  });
  expect(
    await a.query(api.posts.schedule, { from: Date.now(), days: 2 }),
  ).toMatchObject({ held: 0, counts: [0, 0] });
  await expect(root.mutation(api.workspaces.ensure, {})).rejects.toThrow(
    "Unauthorized",
  );
  vi.stubEnv("ANTRE_SECRET", "old-global");
  await expect(
    root.query(api.posts.listQueue, { secret: "old-global" }),
  ).rejects.toThrow("Unauthorized");
});
test("foreign Threads IDs and batches reject before writes and every view stays scoped", async () => {
  const { a, b } = await setup();
  const pa = await a.mutation(api.posts.createDraft, draft);
  const pb = await b.mutation(api.posts.createDraft, {
    ...draft,
    parts: [{ text: "B" }],
  });
  await a.mutation(api.library.setTaxonomy, {
    entries: [{ dimension: "topic", code: "A", name: "Private topic" }],
  });
  const attempts = [
    () =>
      b.mutation(api.posts.updateDraft, {
        id: pa,
        parts: [{ text: "stolen" }],
      }),
    () => b.mutation(api.posts.queue, { id: pa }),
    () => b.mutation(api.posts.unqueue, { id: pa }),
    () => b.mutation(api.posts.publishNow, { id: pa }),
    () => b.mutation(api.posts.retry, { id: pa }),
    () => b.mutation(api.posts.deletePost, { id: pa }),
    () => b.mutation(api.posts.move, { id: pa }),
    () => b.mutation(api.posts.swap, { id: pb, otherId: pa }),
    () =>
      b.mutation(api.posts.setTopicTag, { ids: [pb, pa], topicTag: "Foreign" }),
    () =>
      b.mutation(api.library.tagPosts, {
        posts: [
          { id: pb, meta: { notes: "rollback" } },
          { id: pa, meta: { notes: "stolen" } },
        ],
      }),
  ];
  for (const attempt of attempts)
    await expect(attempt()).rejects.toThrow("Not found");
  expect((await b.query(api.posts.getPosts, { ids: [pa] })).posts).toEqual([
    null,
  ]);
  expect(
    (await b.query(api.posts.getPosts, { ids: [pb] })).posts[0]?.meta,
  ).toEqual({});
  expect(await b.query(api.library.taxonomy, {})).toEqual([]);
  expect(await b.query(api.library.page, { view: "drafts" })).toMatchObject({
    total: 1,
    counts: { drafts: 1 },
  });
  expect(await b.query(api.library.searchPosts, { text: "private" })).toEqual(
    [],
  );
  expect(
    (await a.query(api.posts.getPosts, { ids: [pa] })).posts[0]?.parts[0].text,
  ).toBe("private");
});
test("LinkedIn-only workspaces publish with their own credential and reject foreign IDs", async () => {
  vi.useFakeTimers();
  const { a, b } = await setup();
  const expires = Date.now() + 86_400_000;
  await connectLinkedin(a, {
    memberId: "ma",
    name: "A",
    accessToken: "a-token",
    tokenExpiresAt: expires,
  });
  await connectLinkedin(b, {
    memberId: "mb",
    name: "B",
    accessToken: "b-token",
    tokenExpiresAt: expires,
  });
  const pa = await a.mutation(api.linkedin.createDraft, {
    text: "A's text",
    source: "web",
  });
  for (const attempt of [
    () => b.mutation(api.linkedin.updateDraft, { id: pa, text: "stolen" }),
    () => b.mutation(api.linkedin.queue, { id: pa }),
    () => b.mutation(api.linkedin.unqueue, { id: pa }),
    () => b.mutation(api.linkedin.publishNow, { id: pa }),
    () => b.mutation(api.linkedin.retry, { id: pa }),
    () => b.mutation(api.linkedin.deletePost, { id: pa }),
  ])
    await expect(attempt()).rejects.toThrow("Not found");
  expect(await b.query(api.linkedin.get, { id: pa })).toBeNull();
  const threadsPost = await a.mutation(api.posts.createDraft, draft);
  for (const id of [threadsPost, "not-an-id"])
    expect(await a.query(api.linkedin.get, { id })).toBeNull();
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: URL, init: RequestInit) => {
      calls.push(new Headers(init.headers).get("Authorization") ?? "");
      expect(JSON.parse(String(init.body)).author).toBe("urn:li:person:ma");
      return new Response(null, {
        status: 201,
        headers: { "x-restli-id": "urn:li:share:123" },
      });
    }),
  );
  await a.mutation(api.linkedin.publishNow, { id: pa });
  await a.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual(["Bearer a-token"]);
  expect(await a.query(api.linkedin.get, { id: pa })).toMatchObject({
    status: { kind: "published" },
  });
  expect(await b.query(api.linkedin.list, { view: "published" })).toMatchObject(
    { total: 0 },
  );
  expect(await a.query(api.account.current, {})).toBeNull();
  await expect(
    connectLinkedin(b, {
      memberId: "ma",
      name: "A",
      accessToken: "x",
      tokenExpiresAt: expires,
    }),
  ).rejects.toThrow("already connected");
});
test("owned assets cannot be previewed, attached, deleted or claimed with a guessed ID", async () => {
  const { a, b, wa, wb, root } = await setup();
  const imageId = await root.run((ctx) => asset(ctx, wa));
  await expect(b.query(api.images.preview, { imageId })).rejects.toThrow(
    "Image not found",
  );
  await expect(b.mutation(api.images.remove, { imageId })).rejects.toThrow(
    "Image not found",
  );
  await expect(
    b.mutation(api.posts.createDraft, {
      ...draft,
      parts: [{ text: "steal", imageId }],
    }),
  ).rejects.toThrow("Image not found");
  const own = await b.mutation(api.posts.createDraft, draft);
  await expect(
    b.mutation(api.posts.updateDraft, {
      id: own,
      parts: [{ text: "steal", imageId }],
    }),
  ).rejects.toThrow("Image not found");
  expect(await a.query(api.images.preview, { imageId })).toMatchObject({
    imageId,
    previewUrl: expect.any(String),
  });
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  const url = await b.mutation(api.images.uploadUrl, {});
  const token = new URL(url).searchParams.get("token");
  if (!token) throw new Error("Missing upload token");
  const hash = await tokenHash(token);
  expect(await root.query(internal.images.uploadTicket, { hash })).toBe(wb);
  // An upload capability can ingest bytes; no public function accepts imageId to register ownership.
  const invalid = await root.fetch("/assets/upload?token=guessed", {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: new Uint8Array([137, 80, 78, 71]),
  });
  expect(invalid.ok).toBe(false);
  await a.mutation(api.images.remove, { imageId });
  expect(await root.run((ctx) => ctx.storage.getUrl(imageId))).toBeNull();
});
test("agent credentials are hashed, scoped, revocable and cannot manage connections or grants", async () => {
  const { root, a, b } = await setup();
  const token = "agent-a-unguessable";
  const id = await a.mutation(api.workspaces.createAgentGrant, {
    label: "Editor",
    tokenHash: await tokenHash(token),
  });
  const pa = await root.mutation(api.posts.createDraft, {
    secret: token,
    ...draft,
  });
  const pb = await b.mutation(api.posts.createDraft, draft);
  expect(
    (
      await root.query(api.posts.getPosts, { secret: token, ids: [pa, pb] })
    ).posts.map((post) => post?.id ?? null),
  ).toEqual([pa, null]);
  await expect(
    root.mutation(api.posts.deletePost, { secret: token, id: pb }),
  ).rejects.toThrow("Not found");
  await expect(
    root.mutation(api.workspaces.createAgentGrant, {
      secret: token,
      label: "escalate",
      tokenHash: await tokenHash("other"),
    }),
  ).rejects.toThrow("User session required");
  await expect(
    connectThreads(root, {
      secret: token,
      threadsUserId: "x",
      username: "x",
      accessToken: "x",
      tokenExpiresAt: Date.now() + 10000,
    }),
  ).rejects.toThrow("User session required");
  await expect(
    b.mutation(api.workspaces.revokeAgentGrant, { id }),
  ).rejects.toThrow("Not found");
  expect(
    JSON.stringify(await a.query(api.workspaces.listAgentGrants, {})),
  ).not.toContain(await tokenHash(token));
  await a.mutation(api.workspaces.revokeAgentGrant, { id });
  await a.mutation(api.workspaces.revokeAgentGrant, { id });
  await expect(
    root.query(api.posts.listQueue, { secret: token }),
  ).rejects.toThrow("Unauthorized");
});
test("reply parents, sync deletion batches and stale connection results cannot cross workspace boundaries", async () => {
  const { root, a, b, wa, wb } = await setup();
  const pa = await a.mutation(api.posts.createDraft, draft);
  const pb = await b.mutation(api.posts.createDraft, draft);
  const now = Date.now();
  await root.run(async (ctx) => {
    await ctx.db.patch(pa, {
      publishedIds: ["remote-a"],
      status: { kind: "published", at: now - 600000, permalink: "a" },
    });
    await ctx.db.patch(pb, {
      publishedIds: ["remote-b"],
      status: { kind: "published", at: now - 600000, permalink: "b" },
    });
  });
  const reply = {
    threadsId: "reply-a",
    postId: pa,
    text: "private reply",
    username: "reader",
    at: now,
    mine: false,
    hidden: false,
  };
  await root.mutation(internal.replies.upsert, {
    workspaceId: wa,
    replies: [reply],
  });
  await expect(
    b.mutation(api.replies.saveDraft, { replyId: "reply-a", text: "stolen" }),
  ).rejects.toThrow("Reply not found");
  await expect(b.query(api.replies.list, { postId: pa })).rejects.toThrow(
    "Not found",
  );
  await expect(
    root.mutation(internal.replies.upsert, {
      workspaceId: wb,
      replies: [reply],
    }),
  ).rejects.toThrow("Post not found");
  expect(await b.query(api.replies.list, {})).toMatchObject({ total: 0 });
  expect(
    await root.mutation(internal.sync.removeMissing, {
      workspaceId: wb,
      posts: [{ id: pa, publishedId: "remote-a" }],
      cutoff: now,
    }),
  ).toBe(0);
  expect(
    (await a.query(api.posts.getPosts, { ids: [pa] })).posts[0],
  ).not.toBeNull();
  await connectThreads(a, {
    threadsUserId: "ta",
    username: "A",
    accessToken: "old-a",
    tokenExpiresAt: now + 100000,
  });
  await a.mutation(api.workspaces.disconnect, { channel: "threads" });
  await expect(
    root.mutation(internal.sync.removeMissing, {
      workspaceId: wa,
      expectedToken: "old-a",
      posts: [{ id: pa, publishedId: "remote-a" }],
      cutoff: now,
    }),
  ).rejects.toThrow("Connection changed");
  await root.mutation(internal.publishing.saveToken, {
    workspaceId: wa,
    expectedToken: "old-a",
    token: { accessToken: "late-refresh", tokenExpiresAt: now + 200000 },
  });
  expect(await a.query(api.account.current, {})).toMatchObject({
    needsReconnect: true,
  });
  expect(
    (await root.query(internal.publishing.getAccount, { workspaceId: wa }))
      ?.accessToken,
  ).toBe("");
});
test("deletion fences access and dispatch, preserves receipts until cleanup, and leaves B intact", async () => {
  vi.useFakeTimers();
  const { root, a, b, wa } = await setup();
  await connectLinkedin(a, {
    memberId: "ma",
    name: "A",
    accessToken: "a-token",
    tokenExpiresAt: Date.now() + 100000,
  });
  const pa = await a.mutation(api.linkedin.createDraft, {
    source: "web",
    text: "A",
  });
  const pb = await b.mutation(api.posts.createDraft, draft);
  const imageId = await root.run((ctx) => asset(ctx, wa));
  await a.mutation(api.linkedin.publishNow, { id: pa });
  const post = await a.query(api.linkedin.get, { id: pa });
  if (post?.status.kind !== "publishing")
    throw new Error("Expected publishing");
  const startedAt = post.status.startedAt;
  expect(
    await root.mutation(internal.linkedin.claimDispatch, {
      id: pa,
      startedAt,
      expectedToken: "a-token",
    }),
  ).toBe(true);
  await a.mutation(api.workspaces.deleteWorkspace, {});
  await expect(a.query(api.posts.listQueue, {})).rejects.toThrow(
    "Workspace unavailable",
  );
  await root.mutation(internal.linkedin.complete, {
    id: pa,
    startedAt,
    expectedToken: "a-token",
    result: { kind: "published", urn: "urn:li:share:99" },
  });
  expect(await root.run((ctx) => ctx.db.get(pa))).toMatchObject({
    status: { kind: "published", urn: "urn:li:share:99" },
  });
  await root.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await root.run((ctx) => ctx.db.get(pa))).toBeNull();
  expect(await root.run((ctx) => ctx.storage.getUrl(imageId))).toBeNull();
  expect(
    await root.query(internal.publishing.getAccount, { workspaceId: wa }),
  ).toBeNull();
  await expect(
    root.action(internal.sync.run, { workspaceId: wa }),
  ).rejects.toThrow("Workspace unavailable");
  expect((await b.query(api.posts.getPosts, { ids: [pb] })).posts[0]?.id).toBe(
    pb,
  );
});
test("schema derives the owned table inventory and each table has a leading workspace index", () => {
  const owned: string[] = [];
  for (const [name, table] of Object.entries(schema.tables)) {
    if (["users", "workspaces", "providerReceipts"].includes(name)) continue;
    owned.push(name);
    expect(
      table[" indexes"]().some(
        (index) =>
          index.indexDescriptor === "by_workspace" &&
          index.fields[0] === "workspaceId",
      ),
      name,
    ).toBe(true);
    const validator = table.validator;
    expect("workspaceId" in validator.fields, name).toBe(true);
  }
  expect([...cleanupTables].sort()).toEqual(owned.sort());
});

test("a verified new user reads null before ensure and their workspace after ensure", async () => {
  const root = convexTest(schema, modules);
  const user = root.withIdentity(identity("new-user"));
  expect(await user.query(api.workspaces.current, {})).toBeNull();
  await expect(root.query(api.workspaces.current, {})).rejects.toThrow(
    "Unauthorized",
  );
  await expect(
    user.query(api.workspaces.current, { secret: "invalid" }),
  ).rejects.toThrow("Unauthorized");
  const workspace = await user.mutation(api.workspaces.ensure, {});
  expect((await user.query(api.workspaces.current, {}))?._id).toBe(
    workspace?._id,
  );
});

test.each(["threads", "linkedin"] as const)(
  "%s verifies the platform token before accepting a claimed identity or replacing credentials",
  async (channel) => {
    const { a } = await setup();
    let result: "valid" | "invalid" | "mismatch" = "invalid";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input);
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer candidate-token",
        );
        if (channel === "threads") {
          expect(url.href).toBe(
            "https://graph.threads.net/v1.0/me?fields=id%2Cusername",
          );
          if (result === "invalid")
            return Response.json(
              { error: { code: 190, message: "invalid candidate-token" } },
              { status: 401 },
            );
          return Response.json({
            id: result === "mismatch" ? "other-person" : "claimed",
            username: "verified-name",
          });
        }
        expect(url.href).toBe("https://api.linkedin.com/v2/userinfo");
        if (result === "invalid") return new Response(null, { status: 401 });
        return Response.json({
          sub: result === "mismatch" ? "other-person" : "claimed",
          name: "Verified Name",
        });
      }),
    );
    const connect = () =>
      channel === "threads"
        ? a.action(api.account.connect, {
            threadsUserId: "claimed",
            username: "untrusted-name",
            accessToken: "candidate-token",
            tokenExpiresAt: Date.now() + 100000,
          })
        : a.action(api.linkedin.connect, {
            memberId: "claimed",
            name: "Untrusted Name",
            accessToken: "candidate-token",
            tokenExpiresAt: Date.now() + 100000,
          });
    await expect(connect()).rejects.toThrow("could not be verified");
    result = "mismatch";
    await expect(connect()).rejects.toThrow("identity does not match");
    expect(await a.query(api.account.current, {})).toBeNull();
    expect(await a.query(api.linkedin.current, {})).toBeNull();
    result = "valid";
    await connect();
    expect(
      channel === "threads"
        ? await a.query(api.account.current, {})
        : await a.query(api.linkedin.current, {}),
    ).toMatchObject(
      channel === "threads"
        ? { username: "verified-name" }
        : { name: "Verified Name" },
    );
    result = "invalid";
    await expect(connect()).rejects.toThrow("could not be verified");
    expect(
      channel === "threads"
        ? await a.query(api.account.current, {})
        : await a.query(api.linkedin.current, {}),
    ).toMatchObject({ needsReconnect: false });
  },
);

test("Threads disconnect between parts keeps its receipt and reconnect publishes only the remainder", async () => {
  vi.useFakeTimers();
  const { a, b, wa, root } = await setup();
  await connectThreads(a, {
    threadsUserId: "ta",
    username: "A",
    accessToken: "a-token",
    tokenExpiresAt: Date.now() + 10 * 86_400_000,
  });
  await connectThreads(b, {
    threadsUserId: "tb",
    username: "B",
    accessToken: "b-token",
    tokenExpiresAt: Date.now() + 10 * 86_400_000,
  });
  const pa = await a.mutation(api.posts.createDraft, {
    source: "web",
    parts: [{ text: "A root" }, { text: "A continuation" }],
  });
  const pb = await b.mutation(api.posts.createDraft, {
    source: "web",
    parts: [{ text: "B root" }],
  });
  const containers = new Map<string, { text: string; token: string }>();
  const live: { id: string; text: string; parent?: string }[] = [];
  const sends: string[] = [];
  let disconnect = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const path = url.pathname.slice("/v1.0/".length);
      const token = new Headers(init?.headers).get("Authorization") ?? "";
      const params = new URLSearchParams(String(init?.body));
      if (init?.method === "POST" && path.endsWith("/threads")) {
        const text = params.get("text") ?? "";
        expect(token).toBe(
          text.startsWith("A") ? "Bearer a-token" : "Bearer b-token",
        );
        const id = `container-${containers.size}`;
        containers.set(id, { text, token });
        sends.push(text);
        return Response.json({ id });
      }
      if (init?.method === "POST" && path.endsWith("/threads_publish")) {
        const value = containers.get(params.get("creation_id") ?? "");
        if (!value) throw new Error("Missing container");
        expect(token).toBe(value.token);
        const id = `remote-${live.length}`;
        live.push({ id, text: value.text });
        if (value.text === "A root" && disconnect) {
          disconnect = false;
          await a.mutation(api.workspaces.disconnect, { channel: "threads" });
        }
        return Response.json({ id });
      }
      if (path.startsWith("container-"))
        return Response.json({ status: "FINISHED" });
      if (path === "ta/threads" || path === "me/replies")
        return Response.json({ data: [] });
      if (path.startsWith("remote-"))
        return Response.json({ permalink: `https://threads.net/${path}` });
      throw new Error(`Unexpected platform request ${path}`);
    }),
  );
  await a.mutation(api.posts.publishNow, { id: pa });
  await b.mutation(api.posts.publishNow, { id: pb });
  await root.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await root.query(internal.publishing.getPost, { id: pa }),
  ).toMatchObject({
    publishedIds: [expect.any(String)],
    status: { kind: "held" },
  });
  expect(sends.filter((text) => text.startsWith("A"))).toEqual(["A root"]);
  expect(
    await root.query(internal.publishing.getPost, { id: pb }),
  ).toMatchObject({ status: { kind: "published" } });
  await connectThreads(a, {
    threadsUserId: "ta",
    username: "A",
    accessToken: "a-token",
    tokenExpiresAt: Date.now() + 10 * 86_400_000,
  });
  await root.finishAllScheduledFunctions(vi.runAllTimers);
  expect(sends.filter((text) => text.startsWith("A"))).toEqual([
    "A root",
    "A continuation",
  ]);
  expect(
    await root.query(internal.publishing.getPost, { id: pa }),
  ).toMatchObject({
    publishedIds: [expect.any(String), expect.any(String)],
    status: { kind: "published" },
  });
  expect(
    (await root.query(internal.publishing.getAccount, { workspaceId: wa }))
      ?.accessToken,
  ).toBe("a-token");
});

async function signedProviderRequest(
  userId: string,
  secret = "meta-app-secret",
) {
  const encoded = btoa(
    JSON.stringify({
      algorithm: "HMAC-SHA256",
      user_id: userId,
      issued_at: Math.floor(Date.now() / 1000),
    }),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded)),
  );
  return `${btoa(String.fromCharCode(...signature))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")}.${encoded}`;
}
test("provider callbacks reject forged proofs and uninstall only the verified workspace", async () => {
  const { a, b, root, wa, wb } = await setup();
  vi.stubEnv("THREADS_APP_SECRET", "meta-app-secret");
  await connectThreads(a, {
    threadsUserId: "ta",
    username: "A",
    accessToken: "a-token",
    tokenExpiresAt: Date.now() + 100000,
  });
  await connectThreads(b, {
    threadsUserId: "tb",
    username: "B",
    accessToken: "b-token",
    tokenExpiresAt: Date.now() + 100000,
  });
  await a.mutation(api.workspaces.createAgentGrant, {
    label: "A",
    tokenHash: await tokenHash("agent-a"),
  });
  await b.mutation(api.workspaces.createAgentGrant, {
    label: "B",
    tokenHash: await tokenHash("agent-b"),
  });
  const forged = await signedProviderRequest("ta", "attacker-key");
  await expect(
    root.mutation(api.account.providerCallback, {
      kind: "delete",
      signedRequest: forged,
    }),
  ).rejects.toThrow("Invalid signed request");
  await expect(
    root.mutation(api.account.providerCallback, {
      kind: "uninstall",
      signedRequest: "bad.payload",
    }),
  ).rejects.toThrow("Invalid signed request");
  expect(await a.query(api.account.current, {})).toMatchObject({
    needsReconnect: false,
  });
  const signedRequest = await signedProviderRequest("ta");
  const response = await root.mutation(api.account.providerCallback, {
    kind: "uninstall",
    signedRequest,
  });
  expect(response.confirmationCode).toHaveLength(64);
  expect(await a.query(api.account.current, {})).toMatchObject({
    needsReconnect: true,
  });
  expect(await b.query(api.account.current, {})).toMatchObject({
    needsReconnect: false,
  });
  await expect(
    root.query(api.posts.listQueue, { secret: "agent-a" }),
  ).rejects.toThrow("Unauthorized");
  expect(
    await root.query(api.workspaces.current, { secret: "agent-b" }),
  ).toMatchObject({ _id: wb });
  expect(await a.query(api.workspaces.current, {})).toMatchObject({
    _id: wa,
    state: "active",
  });
  expect(
    await root.mutation(api.account.providerCallback, {
      kind: "uninstall",
      signedRequest,
    }),
  ).toEqual(response);
  expect(
    await root.query(api.account.deletionStatus, {
      confirmationCode: "0".repeat(64),
    }),
  ).toBeNull();
});
test("provider deletion returns an opaque status, fences A, completes cleanup and preserves B", async () => {
  vi.useFakeTimers();
  vi.stubEnv("THREADS_APP_SECRET", "meta-app-secret");
  const { a, b, root, wa } = await setup();
  await connectThreads(a, {
    threadsUserId: "ta",
    username: "A",
    accessToken: "a-token",
    tokenExpiresAt: Date.now() + 100000,
  });
  await connectThreads(b, {
    threadsUserId: "tb",
    username: "B",
    accessToken: "b-token",
    tokenExpiresAt: Date.now() + 100000,
  });
  const pa = await a.mutation(api.posts.createDraft, draft);
  const pb = await b.mutation(api.posts.createDraft, draft);
  await a.mutation(api.posts.queue, { id: pa, at: Date.now() + 60000 });
  const signedRequest = await signedProviderRequest("ta");
  const result = await root.mutation(api.account.providerCallback, {
    kind: "delete",
    signedRequest,
  });
  expect(result).toEqual({
    confirmationCode: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(await root.query(api.account.deletionStatus, result)).toEqual({
    status: "pending",
  });
  await expect(a.query(api.workspaces.current, {})).rejects.toThrow(
    "Workspace unavailable",
  );
  expect(
    await root.mutation(api.account.providerCallback, {
      kind: "delete",
      signedRequest,
    }),
  ).toEqual(result);
  await root.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await root.query(api.account.deletionStatus, result)).toEqual({
    status: "complete",
  });
  expect(await root.run((ctx) => ctx.db.get(wa))).toBeNull();
  expect(await root.run((ctx) => ctx.db.get(pa))).toBeNull();
  expect((await b.query(api.posts.getPosts, { ids: [pb] })).posts[0]?.id).toBe(
    pb,
  );
  expect(await b.query(api.account.current, {})).toMatchObject({
    needsReconnect: false,
  });
  expect(
    await root.mutation(api.account.providerCallback, {
      kind: "delete",
      signedRequest,
    }),
  ).toEqual(result);
});

test("schema rejects unbound posts and workspaces without an owner", async () => {
  const { a, root, wa } = await setup();
  const post = await a.mutation(api.posts.createDraft, draft);
  const linkedin = await a.mutation(api.linkedin.createDraft, {
    text: "owned",
    source: "web",
  });
  for (const id of [post, linkedin])
    await expect(
      root.run((ctx) => ctx.db.patch(id, { workspaceId: undefined })),
    ).rejects.toThrow();
  await expect(
    root.run((ctx) => ctx.db.patch(wa, { ownerId: undefined })),
  ).rejects.toThrow();
  for (const table of cleanupTables) {
    expect(
      schema.tables[table].validator.fields.workspaceId.isOptional,
      table,
    ).toBe("required");
  }
  const workspace = await root.run((ctx) => ctx.db.get(wa));
  expect(workspace?.ownerId).toBeDefined();
});
