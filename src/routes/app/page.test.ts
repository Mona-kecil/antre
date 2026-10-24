import { getFunctionName } from "convex/server";
import { workspaceTest, workosOwner } from "#lib/server/testing.ts";
import { expect, test, vi } from "vitest";
import { actions, load } from "./+page.server";
import {
  actions as compose,
  load as loadCompose,
} from "./compose/+page.server";
import { load as loadLibrary } from "./library/+page.server";
import { api } from "../../../convex/_generated/api";
import schema from "../../../convex/schema";

const bridge = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: undefined }),
}));
const modules = import.meta.glob([
  "../../../convex/**/*.ts",
  "!../../../convex/**/*.test.ts",
]);

test("compose and post actions save, tag, schedule in WIB, unqueue, and delete through the real Convex functions", async () => {
  const { t, other, workspaceId } = await workspaceTest(modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  try {
    await t.run((ctx) =>
      ctx.db.insert("account", {
        workspaceId,
        needsReconnect: false,
        threadsUserId: "owner",
        username: "mona",
        accessToken: "test-token",
        tokenExpiresAt: Date.now() + 100000,
      }),
    );
    const request = (fields: Record<string, string>) =>
      ({
        locals: { userId: workosOwner },
        request: new Request("https://antre.example/", {
          method: "POST",
          body: new URLSearchParams(fields),
        }),
      }) as never;
    expect(
      await compose.compose(
        request({
          parts: JSON.stringify([{ text: "first" }, { text: "second" }]),
          mode: "draft",
          topic: "T1",
          hook: "first",
        }),
      ),
    ).toEqual({ message: "Draft saved", next: "/app" });
    const posts = await t.query(api.posts.listQueue, { secret: "test-secret" });
    expect(posts).toMatchObject([{ meta: { topic: "T1", hook: "first" } }]);
    const id = posts[0]._id;
    const drafts = await load({
      url: new URL("https://antre.example/?topic=T1"),
      locals: { userId: workosOwner },
    } as Parameters<typeof load>[0]);
    expect(drafts).toMatchObject({
      view: "drafts",
      total: 1,
      items: [{ id, meta: { topic: "T1" } }],
      facets: { topic: { T1: 1 } },
    });
    expect(
      await compose.compose(
        request({ parts: JSON.stringify([{ text: " " }]), mode: "draft" }),
      ),
    ).toMatchObject({ status: 400 });
    const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const scheduled = await compose.compose(
      request({
        id,
        parts: JSON.stringify([{ text: "edited" }]),
        mode: "schedule",
        at: `${date}T09:30`,
        topic: "T2",
      }),
    );
    expect(scheduled).toMatchObject({ next: `/app/schedule?day=${date}` });
    expect(
      (await t.query(api.posts.listQueue, { secret: "test-secret" }))[0],
    ).toMatchObject({
      parts: [{ text: "edited" }],
      meta: { topic: "T2" },
      status: { kind: "queued", at: Date.parse(`${date}T09:30:00+07:00`) },
    });
    expect(await actions.post(request({ id, operation: "unqueue" }))).toEqual({
      message: "Moved back to drafts",
    });
    expect(
      (await t.query(api.posts.listQueue, { secret: "test-secret" }))[0].status
        .kind,
    ).toBe("draft");
    expect(
      await actions.post(
        request({ id, operation: "queue", at: "2000-01-01T09:00" }),
      ),
    ).toMatchObject({ status: 400 });
    await actions.post(request({ id, operation: "delete" }));
    expect(await t.query(api.posts.listQueue, { secret: undefined })).toEqual(
      [],
    );
    bridge.query.mockImplementation(other.query);
    bridge.mutation.mockImplementation(other.mutation);
    await expect(
      actions.post({
        ...(request({ id, operation: "delete" }) as object),
        locals: { userId: "someone-else" },
      } as never),
    ).rejects.toBeDefined();
  } finally {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});

test("library load checks the owner and returns only published posts newest first with tags and metrics", async () => {
  const { t, other, workspaceId } = await workspaceTest(modules);
  bridge.query.mockImplementation(t.query);
  try {
    await t.run((ctx) =>
      ctx.db.insert("account", {
        workspaceId,
        needsReconnect: false,
        threadsUserId: "owner",
        username: "mona",
        accessToken: "test-token",
        tokenExpiresAt: Date.now() + 100000,
      }),
    );
    await t.mutation(api.posts.createDraft, {
      secret: "test-secret",
      source: "web",
      parts: [{ text: "not in library" }],
    });
    await t.run(async (ctx) => {
      for (const [text, at] of [
        ["old", 1000],
        ["new", 2000],
      ] as const)
        await ctx.db.insert("posts", {
          workspaceId,
          source: "threads",
          parts: [{ text }],
          publishedIds: [text],
          status: {
            kind: "published",
            at,
            permalink: `https://threads.net/${text}`,
          },
          meta: { topic: "CUSTOM" },
          metrics: {
            views: 100,
            likes: 10,
            replies: 0,
            reposts: 0,
            quotes: 0,
            shares: 0,
            syncedAt: 3000,
          },
        });
    });
    const event = (userId: string, search = "") =>
      ({
        url: new URL(`https://antre.example/app/library${search}`),
        locals: { userId },
      }) as Parameters<typeof loadLibrary>[0];
    expect(await loadLibrary(event(workosOwner))).toMatchObject({
      sort: "date",
      total: 2,
      items: [
        {
          parts: [{ text: "new" }],
          meta: { topic: "CUSTOM" },
          metrics: { views: 100 },
          engagement: 0.1,
        },
        { parts: [{ text: "old" }] },
      ],
    });
    expect(
      await loadLibrary(event(workosOwner, "?q=old&page=1")),
    ).toMatchObject({ total: 1, items: [{ parts: [{ text: "old" }] }] });
    bridge.query.mockImplementation(other.query);
    await expect(loadLibrary(event("someone-else"))).rejects.toBeDefined();
  } finally {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});

test("compose edit finds draft and failed parts by id and rejects missing or scheduled posts", async () => {
  const { t, other, workspaceId } = await workspaceTest(modules);
  bridge.query.mockImplementation(t.query);
  const secret = "test-secret";
  try {
    await t.run((ctx) =>
      ctx.db.insert("account", {
        workspaceId,
        needsReconnect: false,
        threadsUserId: "owner",
        username: "owner",
        accessToken: "test-token",
        tokenExpiresAt: Date.now() + 100000,
      }),
    );
    const id = await t.mutation(api.posts.createDraft, {
      secret,
      source: "web",
      parts: [{ text: "First part" }, { text: "Second part" }],
      meta: { topic: "T1", notes: "Keep these notes" },
    });
    const edit = () =>
      loadCompose({
        url: new URL(`https://antre.example/app/compose?edit=${id}`),
        locals: { userId: workosOwner },
      } as Parameters<typeof loadCompose>[0]);
    expect(await edit()).toMatchObject({
      edit: {
        id,
        failed: false,
        parts: [{ text: "First part" }, { text: "Second part" }],
        meta: { topic: "T1", notes: "Keep these notes" },
      },
      nextSlot: expect.any(Number),
    });
    await t.run((ctx) =>
      ctx.db.patch(id, {
        status: { kind: "failed", at: Date.now(), error: "Failed" },
      }),
    );
    expect(await edit()).toMatchObject({ edit: { id, failed: true } });
    await t.mutation(api.posts.queue, { secret, id });
    await expect(edit()).rejects.toMatchObject({ status: 404 });
    await t.mutation(api.posts.deletePost, { secret, id });
    await expect(edit()).rejects.toMatchObject({ status: 404 });
    expect(
      bridge.query.mock.calls.map(([query]) => getFunctionName(query)),
    ).not.toContain("posts:listQueue");
  } finally {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});
