import { expect, test, vi } from "vitest";
import { isHttpError } from "@sveltejs/kit";
import { handle } from "../../hooks.server";
import { GET as login } from "../login/+server";
vi.mock("$app/env/private", () => ({
  WORKOS_API_KEY: undefined,
  WORKOS_CLIENT_ID: undefined,
  WORKOS_COOKIE_PASSWORD: undefined,
  WORKOS_REDIRECT_URI: undefined,
}));

test.each(["/", "/demo", "/demo/compose", "/privacy"])(
  "%s resolves without any auth or backend configuration",
  async (path) => {
    const resolve = vi.fn(async () => new Response("public"));
    const response = await handle({
      event: {
        url: new URL(path, "https://antre.example"),
        request: new Request("https://antre.example"),
        setHeaders: vi.fn(),
      },
      resolve,
    } as never);
    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalledOnce();
  },
);

test("login names the missing WorkOS setup", async () => {
  const result = await Promise.resolve()
    .then(() => login({} as never))
    .catch((cause: unknown) => cause);
  expect(isHttpError(result) && result.status).toBe(503);
  if (!isHttpError(result)) throw new Error("Expected setup error");
  expect(result.body.message).toContain("WORKOS_COOKIE_PASSWORD");
});

test("demo responses block network connections and form submissions", async () => {
  const setHeaders = vi.fn();
  await handle({
    event: {
      url: new URL("https://antre.example/demo"),
      request: new Request("https://antre.example/demo"),
      setHeaders,
    },
    resolve: async () => new Response("demo"),
  } as never);
  expect(setHeaders).toHaveBeenCalledWith({
    "content-security-policy": expect.stringContaining("connect-src 'none'; form-action 'none'"),
  });
});
