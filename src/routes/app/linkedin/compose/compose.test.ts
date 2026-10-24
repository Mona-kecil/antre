import { workspaceTest, workosOwner } from "#lib/server/testing.ts";
import { expect, test, vi } from "vitest";
import { api } from "../../../../../convex/_generated/api";
import schema from "../../../../../convex/schema";
import { actions } from "./+page.server";

const bridge = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: undefined }),
}));
const modules = import.meta.glob([
  "../../../../../convex/**/*.ts",
  "!../../../../../convex/**/*.test.ts",
]);

test("LinkedIn form edits preserve omitted fields and clear submitted blanks", async () => {
  const { t, other, workspaceId } = await workspaceTest(modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  const secret = "test-secret";
  const save = actions.save;
  if (!save) throw new Error("Missing save action");
  try {
    await t.run((ctx) =>
      ctx.db.insert("account", {
        workspaceId,
        threadsUserId: "owner",
        username: "owner",
        accessToken: "test-token",
        tokenExpiresAt: Date.now() + 86_400_000,
        needsReconnect: false,
      }),
    );
    const id = await t.mutation(api.linkedin.createDraft, {
      secret,
      source: "web",
      text: "Original text",
      topic: "Engineering",
      notes: "Keep the example",
    });
    const submit = (fields: Record<string, string>) => {
      const form = new FormData();
      for (const [key, value] of Object.entries({
        mode: "draft",
        text: "Revised text",
        id,
        ...fields,
      }))
        form.set(key, value);
      return save({
        request: new Request("https://antre.example/app/linkedin/compose", {
          method: "POST",
          body: form,
        }),
        locals: { userId: workosOwner },
      } as Parameters<typeof save>[0]);
    };
    const read = () => t.query(api.linkedin.get, { secret, id });
    await expect(submit({})).rejects.toMatchObject({
      status: 303,
      location: "/app/linkedin",
    });
    expect(await read()).toMatchObject({
      text: "Revised text",
      topic: "Engineering",
      notes: "Keep the example",
    });
    await expect(submit({ notes: "New example" })).rejects.toMatchObject({
      status: 303,
    });
    expect(await read()).toMatchObject({
      topic: "Engineering",
      notes: "New example",
    });
    await expect(submit({ topic: " " })).rejects.toMatchObject({ status: 303 });
    expect(await read()).not.toHaveProperty("topic");
    expect(await read()).toMatchObject({ notes: "New example" });
    await expect(submit({ notes: "" })).rejects.toMatchObject({ status: 303 });
    expect(await read()).not.toHaveProperty("notes");
  } finally {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});
