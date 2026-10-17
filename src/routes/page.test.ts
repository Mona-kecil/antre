import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { actions, load } from "./+page.server";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const bridge = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: "test-secret" }),
}));
const modules = import.meta.glob([
  "../../convex/**/*.ts",
  "!../../convex/**/*.test.ts",
]);

test("form actions save, edit, schedule in WIB, unqueue, and delete through the real Convex functions", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  try {
    await t.mutation(api.account.connect, {
      secret: "test-secret",
      threadsUserId: "owner",
      username: "mona",
      accessToken: "test-token",
      tokenExpiresAt: Date.now() + 100000,
    });
    const invoke = (
      action: keyof typeof actions,
      fields: Record<string, string>,
    ) =>
      actions[action]({
        request: new Request("https://antre.example/", {
          method: "POST",
          body: new URLSearchParams(fields),
        }),
      } as Parameters<(typeof actions)[string]>[0]);
    await invoke("compose", {
      parts: JSON.stringify([{ text: "first" }, { text: "second" }]),
      mode: "draft",
    });
    const posts = await t.query(api.posts.listQueue, { secret: "test-secret" });
    expect(posts).toHaveLength(1);
    const id = posts[0]._id;
    const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const scheduled = await invoke("compose", {
      id,
      parts: JSON.stringify([{ text: "edited" }]),
      mode: "schedule",
      at: `${date}T09:30`,
    });
    expect(scheduled).toMatchObject({ saved: true });
    expect(
      (await t.query(api.posts.listQueue, { secret: "test-secret" }))[0],
    ).toMatchObject({
      parts: [{ text: "edited" }],
      status: { kind: "queued", at: Date.parse(`${date}T09:30:00+07:00`) },
    });
    const page = await load({
      url: new URL("https://antre.example/"),
      locals: { userId: "owner" },
    } as Parameters<typeof load>[0]);
    expect(page).toMatchObject({
      account: { username: "mona" },
      groups: [{ posts: [{ _id: id, status: { kind: "queued" } }] }],
    });
    await invoke("post", { id, operation: "unqueue" });
    expect(
      (await t.query(api.posts.listQueue, { secret: "test-secret" }))[0].status
        .kind,
    ).toBe("draft");
    await invoke("post", { id, operation: "delete" });
    expect(
      await t.query(api.posts.listQueue, { secret: "test-secret" }),
    ).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});
