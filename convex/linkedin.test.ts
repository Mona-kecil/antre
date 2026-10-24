import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { escapeLinkedInText, linkedinTextSchema } from "../src/lib/linkedin";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  connectLinkedin,
  connectThreads,
  ownerTest,
} from "./testing/workspace.test-support";

const day = 86_400_000;
const wib = (value: string) => Date.parse(`${value}+07:00`);
const account = {
  memberId: "member",
  name: "Mona",
  accessToken: "linkedin-token",
  tokenExpiresAt: wib("2026-12-19T06:00:00"),
};
const settings = {
  windows: [{ start: "06:00", end: "12:00" }],
  intervalMinutes: 30,
  timeZone: "Asia/Jakarta" as const,
  gapPolicy: "keepTimes" as const,
};

async function setup() {
  const t = await ownerTest();
  await connectLinkedin(t, { ...account });
  await t.mutation(api.linkedin.updateSettings, { ...settings });
  const draft = (text = "A lesson from shipping.") =>
    t.mutation(api.linkedin.createDraft, {
      text,
      topic: "Engineering",
      source: "web",
    });
  const get = (id: Id<"linkedinPosts">) => t.query(api.linkedin.get, { id });
  return { t, draft, get };
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

test("reconnect before dispatch publishes the unsent attempt with the replacement token", async () => {
  const { t, draft, get } = await setup();
  const id = await draft();
  await t.mutation(api.linkedin.publishNow, { id });
  const original = await t.query(internal.linkedin.publishingInput, { id });
  if (original.post?.status.kind !== "publishing" || !original.account)
    throw new Error("Expected an undispatched attempt");
  await connectLinkedin(t, { ...account, accessToken: "replacement" });
  expect(await t.mutation(internal.linkedin.claimDispatch, {
    id,
    startedAt: original.post.status.startedAt,
    expectedToken: original.account.accessToken,
  })).toBe(false);
  expect((await get(id))?.status.kind).toBe("publishing");
  const publish = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer replacement");
    return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:123" } });
  });
  vi.stubGlobal("fetch", publish);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(publish).toHaveBeenCalledTimes(1);
  expect((await get(id))?.status).toMatchObject({ kind: "published", urn: "urn:li:share:123" });
});

test("connection claims one member, returns no token and preserves separate Threads ownership", async () => {
  const { t } = await setup();
  await connectThreads(t, {
    threadsUserId: "threads-owner",
    username: "Threads owner",
    accessToken: "threads-token",
    tokenExpiresAt: account.tokenExpiresAt,
  });
  expect(await t.query(api.linkedin.current, {})).toEqual({
    memberId: account.memberId,
    name: account.name,
    tokenExpiresAt: account.tokenExpiresAt,
    needsReconnect: false,
  });
  await expect(
    connectLinkedin(t, { ...account, memberId: "other" }),
  ).rejects.toThrow("same LinkedIn member");
  await connectLinkedin(t, {
    ...account,
    accessToken: "replacement",
  });
  expect(
    await t.run(
      async (ctx) =>
        (await ctx.db.query("linkedinAccount").unique())?.accessToken,
    ),
  ).toBe("replacement");
  expect(await t.query(api.account.current, {})).toMatchObject({
    threadsUserId: "threads-owner",
    needsReconnect: false,
  });
  await expect(
    t.query(api.linkedin.current, { secret: "wrong" }),
  ).rejects.toThrow("Unauthorized");
});

test("LinkedIn starts with one daily slot and shares its text parser with callers", async () => {
  const t = await ownerTest();
  expect(await t.query(api.linkedin.getSettings, {})).toEqual({
    windows: [{ start: "08:00", end: "08:00" }],
    intervalMinutes: 60,
    timeZone: "Asia/Jakarta",
    gapPolicy: "keepTimes",
    topics: [],
    writingInstructions: "",
  });
  expect(linkedinTextSchema.parse("  Hello  ")).toBe("Hello");
  expect(linkedinTextSchema.safeParse("😀".repeat(3000)).success).toBe(true);
  expect(linkedinTextSchema.safeParse("😀".repeat(3001)).success).toBe(false);
  expect(escapeLinkedInText("|{}@[]()<>#\\*_~")).toBe(
    "\\|\\{\\}\\@\\[\\]\\(\\)\\<\\>\\#\\\\\\*\\_\\~",
  );
});

test.each(["draft", "failed"] as const)(
  "editing a %s LinkedIn post preserves omitted topic and notes",
  async (kind) => {
    const { t, get } = await setup();
    const id = await t.mutation(api.linkedin.createDraft, {
      source: "agent",
      text: "Original text",
      topic: "Engineering",
      notes: "Keep the example",
    });
    if (kind === "failed")
      await t.run(async (ctx) =>
        ctx.db.patch(id, {
          status: { kind: "failed", at: Date.now(), error: "Rejected" },
        }),
      );
    await t.mutation(api.linkedin.updateDraft, {
      id,
      text: "Revised text",
    });
    expect(await get(id)).toMatchObject({
      text: "Revised text",
      topic: "Engineering",
      notes: "Keep the example",
      status: { kind },
    });
    await t.mutation(api.linkedin.updateDraft, {
      id,
      text: "Topic edit",
      topic: " Writing ",
    });
    expect(await get(id)).toMatchObject({
      topic: "Writing",
      notes: "Keep the example",
    });
    await t.mutation(api.linkedin.updateDraft, {
      id,
      text: "Notes edit",
      notes: " New example ",
    });
    expect(await get(id)).toMatchObject({
      topic: "Writing",
      notes: "New example",
    });
    await t.mutation(api.linkedin.updateDraft, {
      id,
      text: "Clear topic",
      topic: " ",
    });
    expect(await get(id)).not.toHaveProperty("topic");
    expect(await get(id)).toMatchObject({ notes: "New example" });
    await t.mutation(api.linkedin.updateDraft, {
      id,
      text: "Clear notes",
      notes: "",
    });
    await t.mutation(api.linkedin.updateDraft, {
      id,
      text: "Still unlabelled",
    });
    expect(await get(id)).not.toHaveProperty("topic");
    expect(await get(id)).not.toHaveProperty("notes");
  },
);

test("draft validation, editing, list counts and settings stay inside LinkedIn", async () => {
  const { t, draft, get } = await setup();
  await expect(draft(" ")).rejects.toThrow("1–3000");
  await expect(draft("a".repeat(3001))).rejects.toThrow("1–3000");
  const id = await draft("a".repeat(3000));
  await t.mutation(api.linkedin.updateDraft, {
    id,
    text: " Edited ",
    topic: " Systems ",
    notes: " Detail ",
  });
  expect(await get(id)).toMatchObject({
    text: "Edited",
    topic: "Systems",
    notes: "Detail",
    status: { kind: "draft" },
  });
  const threads = await t.mutation(api.posts.createDraft, {
    parts: [{ text: "Threads only" }],
    source: "web",
  });
  const at = await t.mutation(api.posts.queue, { id: threads });
  expect(await t.mutation(api.linkedin.queue, { id })).toBe(at);
  await expect(
    t.mutation(api.linkedin.updateDraft, { id, text: "Changed" }),
  ).rejects.toThrow("Only drafts");
  expect(await t.query(api.linkedin.list, { view: "scheduled" })).toMatchObject(
    {
      total: 1,
      counts: { drafts: 0, scheduled: 1, published: 0, failed: 0 },
      items: [{ id }],
    },
  );
  expect(await t.query(api.library.page, { view: "scheduled" })).toMatchObject({
    counts: { scheduled: 1 },
    items: [{ id: threads }],
  });
  const saved = await t.mutation(api.linkedin.updateSettings, {
    ...settings,
    intervalMinutes: 60,
    topics: ["Systems", "Writing"],
    writingInstructions: "Write about practical engineering.",
  });
  expect(saved).toMatchObject({
    intervalMinutes: 60,
    topics: ["Systems", "Writing"],
  });
  expect(await t.query(api.posts.getSettings, {})).toMatchObject({
    intervalMinutes: 30,
  });
  await t.mutation(api.linkedin.updateSettings, { ...settings });
  expect(await t.query(api.linkedin.getSettings, {})).toMatchObject({
    topics: ["Systems", "Writing"],
    writingInstructions: "Write about practical engineering.",
  });
  await expect(
    t.mutation(api.linkedin.updateSettings, {
      ...settings,
      topics: ["same", "same"],
    }),
  ).rejects.toThrow("distinct");
});

test("queue times reject collisions, canceled jobs cannot publish a requeued draft", async () => {
  const { t, draft, get } = await setup();
  const id = await draft();
  const firstAt = await t.mutation(api.linkedin.queue, { id });
  const queued = await get(id);
  if (queued?.status.kind !== "queued") throw new Error("Expected queued post");
  const second = await draft("Second");
  await expect(
    t.mutation(api.linkedin.queue, { id: second, at: firstAt }),
  ).rejects.toThrow("taken");
  await expect(
    t.mutation(api.linkedin.queue, { id: second, at: Date.now() }),
  ).rejects.toThrow("future");
  await t.mutation(api.linkedin.unqueue, { id });
  await t.mutation(api.linkedin.queue, { id, at: firstAt + 60_000 });
  vi.setSystemTime(firstAt + 60_000);
  await t.mutation(internal.linkedin.fire, {
    id,
    generation: queued.status.generation,
  });
  expect(await get(id)).toMatchObject({
    status: { kind: "queued", at: firstAt + 60_000 },
  });
});

test("automatic queue compaction moves only LinkedIn slots and preserves pinned posts", async () => {
  const { t, draft, get } = await setup();
  await t.mutation(api.linkedin.updateSettings, {
    ...settings,
    gapPolicy: "autoFill",
  });
  const first = await draft("First");
  const second = await draft("Second");
  const pin = await draft("Pinned");
  const at = await t.mutation(api.linkedin.queue, { id: first });
  await t.mutation(api.linkedin.queue, { id: second });
  const pinnedAt = at + 60 * 60_000;
  await t.mutation(api.linkedin.queue, { id: pin, at: pinnedAt });
  await t.mutation(api.linkedin.unqueue, { id: first });
  expect(await get(second)).toMatchObject({
    status: { kind: "queued", at },
    pinned: false,
  });
  expect(await get(pin)).toMatchObject({
    status: { kind: "queued", at: pinnedAt },
    pinned: true,
  });
});

test("publisher sends one personal-profile text request and saves its returned URN", async () => {
  const { t, draft, get } = await setup();
  const fetch = vi.fn(
    async (_url: string, _request?: RequestInit) =>
      new Response(null, {
        status: 201,
        headers: { "x-restli-id": "urn:li:share:123" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("LINKEDIN_API_VERSION", "202608");
  const id = await draft();
  await t.mutation(api.linkedin.publishNow, { id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, request] = fetch.mock.calls[0];
  expect(url).toBe("https://api.linkedin.com/rest/posts");
  expect(request).toMatchObject({
    method: "POST",
    headers: {
      Authorization: "Bearer linkedin-token",
      "LinkedIn-Version": "202608",
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  expect(JSON.parse(String(request?.body))).toMatchObject({
    author: "urn:li:person:member",
    commentary: "A lesson from shipping.",
    lifecycleState: "PUBLISHED",
    visibility: "PUBLIC",
  });
  expect(await get(id)).toMatchObject({
    status: {
      kind: "published",
      urn: "urn:li:share:123",
      permalink: "https://www.linkedin.com/feed/update/urn:li:share:123/",
    },
  });
  await expect(t.mutation(api.linkedin.publishNow, { id })).rejects.toThrow(
    "cannot be published",
  );
});

test.each(["network", "server", "missingId"] as const)(
  "%s outcome stays held through reconnect and requires duplicate-risk confirmation",
  async (mode) => {
    const { t, draft, get } = await setup();
    const fetch = vi.fn(async () => {
      if (mode === "network") throw new Error("lost response");
      return new Response(null, { status: mode === "server" ? 503 : 201 });
    });
    vi.stubGlobal("fetch", fetch);
    const id = await draft();
    await t.mutation(api.linkedin.publishNow, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await get(id)).toMatchObject({
      status: {
        kind: "held",
        reason: "unknown",
        error: expect.stringContaining("duplicate"),
      },
    });
    await connectLinkedin(t, {
      ...account,
      accessToken: "reconnected",
    });
    await t.mutation(internal.linkedin.sweepStuck, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(t.mutation(api.linkedin.publishNow, { id })).rejects.toThrow(
      "duplicate",
    );
    await expect(t.mutation(api.linkedin.retry, { id })).rejects.toThrow(
      "duplicate",
    );
    await expect(t.mutation(api.linkedin.queue, { id })).rejects.toThrow(
      "Only drafts",
    );
    await expect(t.mutation(api.linkedin.unqueue, { id })).rejects.toThrow(
      "cannot be returned",
    );
    fetch.mockResolvedValue(
      new Response(null, {
        status: 201,
        headers: { "x-restli-id": "urn:li:ugcPost:456" },
      }),
    );
    await t.mutation(api.linkedin.retry, {
      id,
      confirmDuplicateRisk: true,
      expectedStartedAt: (await get(id))?.retryAttempt ?? undefined,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await get(id)).toMatchObject({
      status: { kind: "published", urn: "urn:li:ugcPost:456" },
    });
  },
);

test.each(["expired", "unauthorized"] as const)(
  "%s connection holds posts and reconnect schedules only safe auth-held work",
  async (mode) => {
    const { t, draft, get } = await setup();
    const fetch = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const id = await draft();
    if (mode === "expired")
      await t.run(async (ctx) => {
        const row = await ctx.db.query("linkedinAccount").unique();
        if (!row) throw new Error("Missing connection");
        await ctx.db.patch(row._id, { tokenExpiresAt: Date.now() - 1 });
      });
    await t.mutation(api.linkedin.publishNow, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await get(id)).toMatchObject({
      status: { kind: "held", reason: "auth" },
    });
    expect(await t.query(api.linkedin.current, {})).toMatchObject({
      needsReconnect: true,
    });
    expect(fetch).toHaveBeenCalledTimes(mode === "expired" ? 0 : 1);
    await connectLinkedin(t, {
      ...account,
      accessToken: "reconnected",
    });
    const resumed = await get(id);
    expect(resumed).toMatchObject({ status: { kind: "queued" } });
    if (resumed?.status.kind !== "queued")
      throw new Error("Expected queued post");
    expect(resumed.status.at).toBeGreaterThan(Date.now());
  },
);

test("a stale 401 cannot mark a reconnected account invalid", async () => {
  const { t, draft, get } = await setup();
  const id = await draft();
  await t.mutation(api.linkedin.publishNow, { id });
  const post = await get(id);
  if (post?.status.kind !== "publishing")
    throw new Error("Expected publishing post");
  await connectLinkedin(t, {
    ...account,
    accessToken: "replacement",
  });
  await t.mutation(internal.linkedin.complete, {
    id,
    startedAt: post.status.startedAt,
    expectedToken: account.accessToken,
    result: { kind: "auth", error: "Old request rejected" },
  });
  expect(await t.query(api.linkedin.current, {})).toMatchObject({
    needsReconnect: false,
  });
  expect(await get(id)).toMatchObject({ status: { kind: "queued" } });
});

test("claimed dispatch runs once, stuck recovery holds it, and matching late success resolves it", async () => {
  const { t, draft, get } = await setup();
  const fetch = vi.fn(
    async () =>
      new Response(null, {
        status: 201,
        headers: { "x-restli-id": "urn:li:share:789" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const id = await draft();
  await t.mutation(api.linkedin.publishNow, { id });
  const post = await get(id);
  if (post?.status.kind !== "publishing")
    throw new Error("Expected publishing post");
  expect(
    await t.mutation(internal.linkedin.claimDispatch, {
      expectedToken: account.accessToken,
      id,
      startedAt: post.status.startedAt,
    }),
  ).toBe(true);
  expect(
    await t.mutation(internal.linkedin.claimDispatch, {
      expectedToken: account.accessToken,
      id,
      startedAt: post.status.startedAt,
    }),
  ).toBe(false);
  vi.setSystemTime(Date.now() + 16 * 60_000);
  await t.mutation(internal.linkedin.sweepStuck, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetch).not.toHaveBeenCalled();
  expect(await get(id)).toMatchObject({
    status: { kind: "held", reason: "unknown" },
  });
  await t.mutation(internal.linkedin.complete, {
    id,
    startedAt: post.status.startedAt,
    expectedToken: account.accessToken,
    result: { kind: "published", urn: "urn:li:share:789" },
  });
  expect(await get(id)).toMatchObject({
    status: { kind: "published", urn: "urn:li:share:789" },
  });
});

test("an approved retry fences an earlier attempt's late success within the same millisecond", async () => {
  const { t, draft, get } = await setup();
  const id = await draft();
  await t.mutation(api.linkedin.publishNow, { id });
  const original = await get(id);
  if (original?.status.kind !== "publishing")
    throw new Error("Expected publishing post");
  await t.mutation(internal.linkedin.complete, {
    id,
    startedAt: original.status.startedAt,
    expectedToken: account.accessToken,
    result: { kind: "unknown", error: "No response" },
  });
  await t.mutation(api.linkedin.retry, {
    id,
    confirmDuplicateRisk: true,
    expectedStartedAt: original.status.startedAt,
  });
  await t.mutation(internal.linkedin.complete, {
    id,
    startedAt: original.status.startedAt,
    expectedToken: account.accessToken,
    result: { kind: "published", urn: "urn:li:share:789" },
  });
  const retried = await get(id);
  expect(retried).toMatchObject({ status: { kind: "publishing" } });
  if (retried?.status.kind !== "publishing")
    throw new Error("Expected publishing post");
  expect(retried.status.startedAt).toBeGreaterThan(original.status.startedAt);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(null, {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:999" },
        }),
    ),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await get(id)).toMatchObject({
    status: { kind: "published", urn: "urn:li:share:999" },
  });
});

test.each([
  [200, "held"],
  [202, "held"],
  [400, "failed"],
  [403, "failed"],
  [408, "held"],
  [429, "failed"],
  [500, "held"],
] as const)(
  "HTTP %s classifies as %s without automatic publishing retries",
  async (status, kind) => {
    const { t, draft, get } = await setup();
    const fetch = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetch);
    const id = await draft();
    await t.mutation(api.linkedin.publishNow, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await get(id)).toMatchObject({
      status: { kind, ...(kind === "held" ? { reason: "unknown" } : {}) },
    });
    vi.setSystemTime(Date.now() + day);
    await t.mutation(internal.linkedin.sweepStuck, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test("pre-dispatch stuck action restarts once and a definite rejection stays failed", async () => {
  const { t, draft, get } = await setup();
  const fetch = vi.fn(async () => new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  const id = await draft();
  await t.mutation(api.linkedin.publishNow, { id });
  vi.setSystemTime(Date.now() + 16 * 60_000);
  await t.mutation(internal.linkedin.sweepStuck, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await get(id)).toMatchObject({
    status: { kind: "failed", error: expect.stringContaining("403") },
  });
  expect(await t.query(api.linkedin.current, {})).toMatchObject({
    needsReconnect: false,
  });
});

test("unknown retry confirmation cannot be replayed against a later ambiguous attempt", async () => {
  const { t, draft, get } = await setup();
  const fetch = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const id = await draft();
  expect((await get(id))?.retryAttempt).toBeNull();
  await t.mutation(api.linkedin.publishNow, { id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const first = await get(id);
  if (first?.retryAttempt == null)
    throw new Error("Expected an unknown held attempt");
  const confirmation = {
    id,
    confirmDuplicateRisk: true,
    expectedStartedAt: first.retryAttempt,
  };
  expect(await t.query(api.linkedin.list, { view: "scheduled" })).toMatchObject(
    { items: [{ id, retryAttempt: first.retryAttempt }] },
  );
  await expect(
    t.mutation(api.linkedin.retry, { id, confirmDuplicateRisk: true }),
  ).rejects.toThrow("duplicate");
  await t.mutation(api.linkedin.retry, confirmation);
  expect((await get(id))?.retryAttempt).toBeNull();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const second = await get(id);
  if (second?.retryAttempt == null)
    throw new Error("Expected another unknown held attempt");
  expect(second.retryAttempt).toBeGreaterThan(first.retryAttempt);
  await expect(t.mutation(api.linkedin.retry, confirmation)).rejects.toThrow(
    "duplicate",
  );
  expect(await get(id)).toEqual(second);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValue(
    new Response(null, {
      status: 201,
      headers: { "x-restli-id": "urn:li:share:1000" },
    }),
  );
  await t.mutation(api.linkedin.retry, {
    ...confirmation,
    expectedStartedAt: second.retryAttempt,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(await get(id)).toMatchObject({
    retryAttempt: null,
    status: { kind: "published", urn: "urn:li:share:1000" },
  });
});
