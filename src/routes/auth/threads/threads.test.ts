import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET as start } from "./+server";
import { GET as callback } from "../callback/+server";

const bridge = vi.hoisted(() => ({ query: vi.fn(), action: vi.fn() }));
vi.mock("$app/env/private", () => ({
  THREADS_APP_ID: "test_threads_app",
  THREADS_APP_SECRET: "test_threads_secret",
}));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: undefined }),
}));
const locals = {
  userId: "user_workos_owner",
  sessionId: "workos_session",
  accessToken: "workos_access_token",
};
beforeEach(() =>
  bridge.query.mockImplementation(async (ref) =>
    getFunctionName(ref) === "workspaces:current"
      ? { _id: "workspace_test", state: "active" }
      : null,
  ),
);
afterEach(() => vi.resetAllMocks());

async function pending() {
  const jar = new Map<string, string>([
    ["antre_session", "existing_workos_seal"],
  ]);
  const cookies = {
    get: (name: string) => jar.get(name),
    set: vi.fn((name: string, value: string, _options: unknown) => {
      jar.set(name, value);
    }),
    delete: vi.fn((name: string, _options: unknown) => jar.delete(name)),
  };
  const result = await Promise.resolve()
    .then(() =>
      start({
        url: new URL("https://antre.example/auth/threads"),
        cookies,
        locals,
      } as never),
    )
    .catch((cause: unknown) => cause);
  expect(result).toMatchObject({ status: 302 });
  const state: { state: string } = JSON.parse(
    jar.get("threads_state") ?? "null",
  );
  const event = {
    cookies,
    locals,
    url: new URL(
      `https://antre.example/auth/callback?state=${state.state}&code=test_code`,
    ),
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "short_threads_token" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: "long_threads_token",
          expires_in: 5184000,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: "threads_profile_id", username: "owner" }),
      ),
  };
  return { jar, cookies, event };
}

test("Threads attaches the posting profile to the WorkOS workspace without replacing its app session", async () => {
  const { jar, cookies, event } = await pending();
  await expect(callback(event as never)).rejects.toMatchObject({
    status: 303,
    location: "/app/settings?connection=connected",
  });
  expect(event.fetch).toHaveBeenCalledTimes(3);
  expect(bridge.action).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      secret: undefined,
      threadsUserId: "threads_profile_id",
      accessToken: "long_threads_token",
    }),
  );
  expect(jar.get("antre_session")).toBe("existing_workos_seal");
  expect(cookies.set.mock.calls.map(([name]) => name)).toEqual([
    "threads_state",
  ]);
  expect(jar.has("threads_state")).toBe(false);
  await expect(callback(event as never)).rejects.toMatchObject({ status: 400 });
  expect(event.fetch).toHaveBeenCalledTimes(3);
});

test.each(["session", "user", "workspace", "state"])(
  "Threads rejects a different %s before provider requests",
  async (changed) => {
    const { event } = await pending();
    if (changed === "session")
      event.locals = { ...locals, sessionId: "another_session" };
    if (changed === "user")
      event.locals = { ...locals, userId: "user_workos_other" };
    if (changed === "workspace")
      bridge.query.mockImplementation(async (ref) =>
        getFunctionName(ref) === "workspaces:current"
          ? { _id: "another_workspace", state: "active" }
          : null,
      );
    if (changed === "state") event.url.searchParams.set("state", "wrong");
    await expect(callback(event as never)).rejects.toMatchObject({
      status: 400,
    });
    expect(event.fetch).not.toHaveBeenCalled();
    expect(bridge.action).not.toHaveBeenCalled();
  },
);

test("Threads rejects malformed provider data without saving credentials", async () => {
  const { event } = await pending();
  event.fetch
    .mockReset()
    .mockResolvedValueOnce(Response.json({ access_token: "" }));
  await expect(callback(event as never)).rejects.toMatchObject({ status: 502 });
  expect(bridge.action).not.toHaveBeenCalled();
});
