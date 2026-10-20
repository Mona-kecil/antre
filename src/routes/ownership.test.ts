import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { load as loadLayout } from "./+layout.server";
import { actions as drafts, load as loadDrafts } from "./+page.server";
import { actions as compose, load as loadCompose } from "./compose/+page.server";
import { load as loadLibrary } from "./library/+page.server";
import { actions as replies, load as loadReplies } from "./replies/+page.server";
import { load as loadSchedule } from "./schedule/+page.server";
import { actions as settings } from "./settings/+page.server";

const bridge = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  action: vi.fn(),
}));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: "test-secret" }),
}));
const modules = import.meta.glob([
  "../../convex/**/*.ts",
  "!../../convex/**/*.test.ts",
]);
const now = Date.parse("2026-10-18T04:00:00Z");
const account = {
  threadsUserId: "owner",
  username: "owner",
  needsReconnect: false,
  tokenExpiresAt: now + 86_400_000,
  lastRefreshError: null,
  lastRefreshErrorAt: null,
};

beforeEach(() => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function database(userId: string | null = "owner") {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    if (userId !== null)
      await ctx.db.insert("account", {
        threadsUserId: userId,
        username: userId,
        accessToken: "private-access-token",
        tokenExpiresAt: account.tokenExpiresAt,
        needsReconnect: false,
      });
    await ctx.db.insert("posts", {
      source: "web",
      parts: [{ text: "Private draft" }],
      publishedIds: [],
      status: { kind: "draft" },
    });
    const postId = await ctx.db.insert("posts", {
      source: "threads",
      parts: [{ text: "Private published post" }],
      publishedIds: ["root"],
      status: {
        kind: "published",
        at: now - 1000,
        permalink: "https://threads.net/root",
      },
    });
    for (const { threadsId, draft } of [
      { threadsId: "drafted", draft: "Private reply draft" },
      { threadsId: "unanswered", draft: undefined },
    ])
      await ctx.db.insert("replies", {
        postId,
        threadsId,
        username: "reader",
        text: "Private reply",
        draft,
        at: now,
        repliedToId: "root",
        mine: false,
        hidden: false,
      });
  });
  return t;
}

const event = (path: string) =>
  ({ url: new URL(path, "https://antre.example"), locals: { userId: "owner" } }) as never;
const reads = [
  {
    name: "Drafts",
    run: () => loadDrafts(event("/")),
    expected: { total: 1, items: [{ parts: [{ text: "Private draft" }] }] },
  },
  {
    name: "Library",
    run: () => loadLibrary(event("/library")),
    expected: { total: 1, items: [{ parts: [{ text: "Private published post" }] }] },
  },
  {
    name: "Schedule",
    run: () => loadSchedule(event("/schedule")),
    expected: { account, nextSlot: expect.any(Number) },
  },
  {
    name: "Compose",
    run: () => loadCompose(event("/compose")),
    expected: { edit: null, nextSlot: expect.any(Number) },
  },
  {
    name: "Replies",
    run: () => loadReplies(event("/replies")),
    expected: {
      account,
      replies: [{ replyId: "drafted" }, { replyId: "unanswered" }],
    },
  },
  {
    name: "Layout",
    run: () => loadLayout(event("/")),
    expected: { account, taxonomy: [], badges: { drafts: 1, replies: 1 } },
  },
];

test.each(reads)("$name loads from fresh query accounts without a preliminary account read", async ({ run, expected }) => {
  const t = await database();
  bridge.query.mockImplementation(t.query);
  const result = await run();
  expect(result).toMatchObject(expected);
  expect(JSON.stringify(result)).not.toContain("accessToken");
  expect(JSON.stringify(result)).not.toContain("private-access-token");
  expect(bridge.query.mock.calls.map(([query]) => getFunctionName(query))).not.toContain(
    getFunctionName(api.account.current),
  );
});

test.each(["owner", null, "someone-else"])(
  "Compose edit rejects a missing or foreign lookup account %s with a matching schedule account",
  async (userId) => {
    const queue = await database(userId);
    const schedule = await database();
    const posts = await queue.query(api.posts.listQueue, { secret: "test-secret" });
    const post = posts.find((post) => post.status.kind === "draft");
    if (!post) throw new Error("Expected a draft");
    bridge.query.mockImplementation((query, args) =>
      getFunctionName(query) === "posts:getPosts"
        ? queue.query(query, args)
        : schedule.query(query, args),
    );
    const result = loadCompose(event(`/compose?edit=${post._id}`));
    if (userId !== "owner") {
      await expect(result).rejects.toMatchObject({
        status: 403,
        body: { message: "This session does not belong to the owner" },
      });
      return;
    }
    await expect(result).resolves.toMatchObject({
      edit: { id: post._id, parts: [{ text: "Private draft" }] },
      nextSlot: expect.any(Number),
    });
    expect(bridge.query.mock.calls.map(([query]) => getFunctionName(query))).toEqual([
      "posts:getPosts",
      "posts:schedule",
    ]);
  },
);

const guardedReads: {
  name: string;
  run: () => unknown;
  query: string;
  drafted?: boolean;
}[] = [
  { name: "Drafts list", run: reads[0].run, query: "library:page" },
  { name: "Drafts schedule", run: reads[0].run, query: "posts:schedule" },
  { name: "Library list", run: reads[1].run, query: "library:page" },
  { name: "Schedule", run: reads[2].run, query: "posts:schedule" },
  { name: "Compose", run: reads[3].run, query: "posts:schedule" },
  {
    name: "Compose missing edit",
    run: () => loadCompose(event("/compose?edit=missing")),
    query: "posts:schedule",
  },
  { name: "Replies drafted", run: reads[4].run, query: "replies:list", drafted: true },
  { name: "Replies unanswered", run: reads[4].run, query: "replies:list", drafted: false },
  { name: "Layout drafts", run: reads[5].run, query: "library:page" },
  { name: "Layout replies", run: reads[5].run, query: "replies:list" },
];

test.each(
  guardedReads.flatMap((read) =>
    [null, "someone-else"].map((userId) => ({ ...read, userId })),
  ),
)("$name rejects account $userId before returning records", async ({ run, query: target, drafted, userId }) => {
  const matching = await database();
  const rejected = await database(userId);
  bridge.query.mockImplementation((query, args) =>
    getFunctionName(query) === target &&
    (drafted === undefined || Boolean(args.drafted) === drafted)
      ? rejected.query(query, args)
      : matching.query(query, args),
  );
  await expect(run()).rejects.toMatchObject({
    status: 403,
    body: { message: "This session does not belong to the owner" },
  });
});

test("a later read rejects an account removed after a successful load", async () => {
  const t = await database();
  bridge.query.mockImplementation(t.query);
  await reads[0].run();
  await t.run(async (ctx) => {
    const row = await ctx.db.query("account").unique();
    if (row) await ctx.db.delete(row._id);
  });
  await expect(reads[0].run()).rejects.toMatchObject({ status: 403 });
});

test("Compose checks the owner before its missing-edit error", async () => {
  const t = await database();
  bridge.query.mockImplementation(t.query);
  await expect(loadCompose(event("/compose?edit=missing"))).rejects.toMatchObject({
    status: 404,
  });
});

const writes = [
  { name: "post", run: drafts.post },
  { name: "compose", run: compose.compose },
  { name: "reply", run: replies.reply },
  { name: "settings", run: settings.save },
];

test.each(
  writes.flatMap((write) =>
    [null, "someone-else"].map((userId) => ({ ...write, userId })),
  ),
)("$name rejects account $userId before writing", async ({ run, userId }) => {
  const t = await database(userId);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  bridge.action.mockImplementation(t.action);
  await expect(
    run({
      locals: { userId: "owner" },
      request: new Request("https://antre.example/", { method: "POST" }),
    } as never),
  ).rejects.toMatchObject({ status: 403 });
  expect(bridge.query.mock.calls.map(([query]) => getFunctionName(query))).toEqual([
    getFunctionName(api.account.current),
  ]);
  expect(bridge.mutation).not.toHaveBeenCalled();
  expect(bridge.action).not.toHaveBeenCalled();
});
