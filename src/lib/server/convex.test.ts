import { afterEach, expect, test, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import { agentConvex, convex } from "./convex.ts";

const context = vi.hoisted(() => ({ locals: {} as App.Locals }));
vi.mock("$app/env/private", () => ({
  CONVEX_URL: "https://workspace-test.convex.cloud",
}));
vi.mock("$app/server", () => ({ getRequestEvent: () => context }));
afterEach(() => vi.unstubAllGlobals());

test("each web client keeps its request's verified WorkOS bearer after another client is created", async () => {
  const requests = vi.fn<typeof fetch>(async () =>
    Response.json({ status: "success", value: null, logLines: [] }),
  );
  vi.stubGlobal("fetch", requests);
  context.locals = { userId: "user_a", accessToken: "workos_token_a" };
  const first = convex();
  context.locals = { userId: "user_b", accessToken: "workos_token_b" };
  const second = convex();
  await first.client.query(api.workspaces.current, {});
  await second.client.query(api.workspaces.current, {});
  expect(first.secret).toBeUndefined();
  expect(second.secret).toBeUndefined();
  expect(
    requests.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("authorization"),
    ),
  ).toEqual(["Bearer workos_token_a", "Bearer workos_token_b"]);
});

test("agent clients forward a scoped credential without inheriting browser authentication", async () => {
  const requests = vi.fn<typeof fetch>(async () =>
    Response.json({ status: "success", value: null, logLines: [] }),
  );
  vi.stubGlobal("fetch", requests);
  const { client, secret } = agentConvex("test_scoped_grant");
  await client.query(api.workspaces.current, { secret });
  expect(
    new Headers(requests.mock.calls[0][1]?.headers).has("authorization"),
  ).toBe(false);
  expect(String(requests.mock.calls[0][1]?.body)).toContain(
    "test_scoped_grant",
  );
});

test("web clients reject a missing session before issuing a backend request", () => {
  context.locals = {};
  expect(() => convex()).toThrow();
});
