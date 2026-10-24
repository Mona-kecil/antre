import { afterEach, expect, test, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import {
  workspaceTest,
  workosOwner,
  workosOther,
} from "#lib/server/testing.ts";
import { load as loadLayout } from "./+layout.server";
import { actions as drafts, load as loadDrafts } from "./+page.server";
import {
  actions as compose,
  load as loadCompose,
} from "./compose/+page.server";
import { load as loadLibrary } from "./library/+page.server";
import {
  actions as replies,
  load as loadReplies,
} from "./replies/+page.server";
import { load as loadSchedule } from "./schedule/+page.server";
import { actions as settings } from "./settings/+page.server";
import { load as loadLinkedIn } from "./linkedin/+page.server";

const bridge = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  action: vi.fn(),
}));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: undefined }),
}));
const modules = import.meta.glob([
  "../../../convex/**/*.ts",
  "!../../../convex/**/*.test.ts",
]);
afterEach(() => vi.resetAllMocks());
const event = (path: string, userId = workosOwner) =>
  ({
    url: new URL(path, "https://antre.example"),
    locals: { userId },
  }) as never;
const reads = [
  {
    name: "Drafts",
    run: () => loadDrafts(event("/app")),
    expected: { total: 1, items: [{ parts: [{ text: "Private draft" }] }] },
  },
  {
    name: "Library",
    run: () => loadLibrary(event("/app/library")),
    expected: {
      total: 1,
      items: [{ parts: [{ text: "Private published post" }] }],
    },
  },
  {
    name: "Schedule",
    run: () => loadSchedule(event("/app/schedule")),
    expected: { account: { threadsUserId: "threads_profile_owner" } },
  },
  {
    name: "Compose",
    run: () => loadCompose(event("/app/compose")),
    expected: { edit: null },
  },
  {
    name: "Replies",
    run: () => loadReplies(event("/app/replies")),
    expected: { replies: [{ replyId: "drafted" }, { replyId: "unanswered" }] },
  },
  {
    name: "Layout",
    run: () => loadLayout(event("/app")),
    expected: { taxonomy: [], badges: { drafts: 1, replies: 1 } },
  },
];
async function database(connected = true) {
  const fixture = await workspaceTest(modules);
  const { t, workspaceId } = fixture;
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  bridge.action.mockImplementation(t.action);
  if (connected)
    await t.run((ctx) =>
      ctx.db.insert("account", {
        workspaceId,
        needsReconnect: false,
        threadsUserId: "threads_profile_owner",
        username: "owner",
        accessToken: "private-access-token",
        tokenExpiresAt: Date.now() + 86_400_000,
      }),
    );
  const draftId = await t.mutation(api.posts.createDraft, {
    source: "web",
    parts: [{ text: "Private draft" }],
  });
  await t.run(async (ctx) => {
    const postId = await ctx.db.insert("posts", {
      workspaceId,
      source: "threads",
      parts: [{ text: "Private published post" }],
      publishedIds: ["root"],
      status: {
        kind: "published",
        at: Date.now() - 1000,
        permalink: "https://threads.net/root",
      },
    });
    for (const { threadsId, draft } of [
      { threadsId: "drafted", draft: "Private reply draft" },
      { threadsId: "unanswered", draft: undefined },
    ]) {
      await ctx.db.insert("replies", {
        workspaceId,
        postId,
        threadsId,
        username: "reader",
        text: "Private reply",
        draft,
        at: Date.now(),
        repliedToId: "root",
        mine: false,
        hidden: false,
      });
    }
  });
  return { ...fixture, draftId };
}

test.each(reads)(
  "$name reads a WorkOS-owned workspace whose Threads ID differs from its subject",
  async ({ run, expected }) => {
    await database();
    const result = await run();
    expect(result).toMatchObject(expected);
    expect(JSON.stringify(result)).not.toContain("accessToken");
    expect(JSON.stringify(result)).not.toContain("private-access-token");
  },
);

test.each(reads)(
  "$name returns only the authenticated second workspace",
  async ({ run }) => {
    const { other } = await database();
    await other.mutation(api.workspaces.ensure, {});
    bridge.query.mockImplementation(other.query);
    bridge.mutation.mockImplementation(other.mutation);
    const result = await run();
    expect(JSON.stringify(result)).not.toContain("Private draft");
    expect(JSON.stringify(result)).not.toContain("Private published post");
    expect(JSON.stringify(result)).not.toContain("Private reply");
  },
);

test("Threads pages and LinkedIn-only drafts work without a Threads profile", async () => {
  const { t, workspaceId } = await database(false);
  expect(await loadLayout(event("/app"))).toMatchObject({ account: null });
  expect(await loadDrafts(event("/app"))).toMatchObject({ total: 1 });
  expect(await loadCompose(event("/app/compose"))).toMatchObject({
    edit: null,
  });
  await t.run((ctx) =>
    ctx.db.insert("linkedinAccount", {
      workspaceId,
      needsReconnect: false,
      memberId: "linkedin_only",
      name: "LinkedIn Owner",
      accessToken: "private-linkedin-token",
      tokenExpiresAt: Date.now() + 86_400_000,
    }),
  );
  expect(await loadLinkedIn(event("/app/linkedin"))).toMatchObject({
    connection: { memberId: "linkedin_only" },
  });
});

test("foreign draft IDs do not cross the authenticated workspace boundary", async () => {
  const { other, draftId } = await database();
  await other.mutation(api.workspaces.ensure, {});
  bridge.query.mockImplementation(other.query);
  bridge.mutation.mockImplementation(other.mutation);
  await expect(
    loadCompose(event(`/app/compose?edit=${draftId}`, workosOther)),
  ).rejects.toBeDefined();
  const body = new URLSearchParams({ id: draftId, operation: "delete" });
  const result = await drafts.post({
    locals: { userId: workosOther },
    request: new Request("https://antre.example/app", { method: "POST", body }),
  } as never);
  expect(result).toMatchObject({ status: 400 });
});

const writes = [
  { name: "post", run: drafts.post },
  { name: "compose", run: compose.compose },
  { name: "reply", run: replies.reply },
  { name: "settings", run: settings.save },
];
test.each(writes)(
  "$name rejects a session with no authorized workspace before writing",
  async ({ run }) => {
    const { other } = await database();
    bridge.query.mockImplementation(other.query);
    bridge.mutation.mockImplementation(other.mutation);
    bridge.action.mockImplementation(other.action);
    bridge.mutation.mockClear();
    bridge.action.mockClear();
    await expect(
      run({
        locals: { userId: workosOther },
        request: new Request("https://antre.example/app", { method: "POST" }),
      } as never),
    ).rejects.toBeDefined();
    expect(bridge.mutation).not.toHaveBeenCalled();
    expect(bridge.action).not.toHaveBeenCalled();
  },
);
