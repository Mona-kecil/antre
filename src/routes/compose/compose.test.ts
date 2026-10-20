import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import schema from "../../../convex/schema";
import { actions, load } from "./+page.server";

const bridge = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: "test-secret" }),
}));
const modules = import.meta.glob([
  "../../../convex/**/*.ts",
  "!../../../convex/**/*.test.ts",
]);

test("the composer saves, reloads and clears a public topic and rejects invalid tags before saving", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  await t.run((ctx) =>
    ctx.db.insert("account", {
      threadsUserId: "owner",
      username: "owner",
      accessToken: "test-token",
      tokenExpiresAt: Date.now() + 86_400_000,
      needsReconnect: false,
    }),
  );
  const compose = actions.compose;
  if (!compose) throw new Error("Missing compose action");
  const save = (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      mode: "draft",
      parts: JSON.stringify([{ text: "Composer topic" }]),
      ...fields,
    }))
      form.set(key, value);
    return compose({
      request: new Request("https://antre.example/compose", {
        method: "POST",
        body: form,
      }),
      locals: { userId: "owner" },
    } as Parameters<typeof compose>[0]);
  };
  try {
    expect(await save({ topicTag: "A&B" })).toMatchObject({ status: 400 });
    expect(
      (
        await t.query(api.library.page, {
          secret: "test-secret",
          view: "drafts",
        })
      ).total,
    ).toBe(0);
    expect(await save({ topic: "T15" })).toMatchObject({
      message: "Draft saved",
    });
    const [draft] = await t.query(api.posts.listQueue, {
      secret: "test-secret",
    });
    expect(draft.topicTag).toBe("Marketing");
    const open = () =>
      load({
        url: new URL(`https://antre.example/compose?edit=${draft._id}`),
        locals: { userId: "owner" },
      } as Parameters<typeof load>[0]);
    expect(await open()).toMatchObject({
      edit: { topicTag: "Marketing", topicTagLocked: false },
    });
    expect(
      await save({ id: draft._id, topicTag: "  Ecommerce  " }),
    ).toMatchObject({ message: "Draft saved" });
    expect(await open()).toMatchObject({ edit: { topicTag: "Ecommerce" } });
    await save({ id: draft._id });
    expect(await open()).toMatchObject({ edit: { topicTag: "Ecommerce" } });
    await save({ id: draft._id, topicTag: "" });
    expect(await open()).toMatchObject({ edit: { topicTag: "" } });
  } finally {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});
