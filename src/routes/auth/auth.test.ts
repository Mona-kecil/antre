import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import { GET as login } from "../login/+server";
import { GET as callback } from "./workos/callback/+server";
import { POST as logout } from "../logout/+server";
import { handle } from "../../hooks.server";
import { readSession, safeReturnPath } from "#lib/server/session.ts";

const backend = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("$app/env/private", () => ({
  WORKOS_API_KEY: "sk_test_only",
  WORKOS_CLIENT_ID: "client_test_only",
  WORKOS_COOKIE_PASSWORD: "test-cookie-password-at-least-32-characters",
}));
vi.mock("#lib/server/convex.ts", () => ({
  authenticatedConvex: () => ({ client: backend, secret: undefined }),
}));

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = publicKey.export({ format: "jwk" });
const issuer = "https://api.workos.com/user_management/client_test_only";
const userId = "user_workos_owner";
const profile = {
  object: "user",
  id: userId,
  email: "owner@example.test",
  email_verified: true,
  first_name: "Owner",
  last_name: null,
  profile_picture_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  external_id: null,
  metadata: {},
};
function jwt(expires = Math.floor(Date.now() / 1000) + 300) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      sub: userId,
      sid: "session_test",
      exp: expires,
      iat: Math.floor(Date.now() / 1000) - 600,
    }),
  ).toString("base64url");
  return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`;
}
let accessToken: string;
let refreshFailure: number | undefined;
const network = vi.fn<typeof fetch>(async (input) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input
        : input.url,
  );
  if (url.pathname.includes("/jwks/"))
    return Response.json({
      keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }],
    });
  if (url.pathname === "/user_management/authenticate") {
    if (refreshFailure)
      return Response.json(
        {
          error: refreshFailure === 400 ? "invalid_grant" : "server_error",
          error_description: "test failure",
        },
        { status: refreshFailure },
      );
    return Response.json({
      user: profile,
      access_token: accessToken,
      refresh_token: "refresh_test",
      authentication_method: "password",
    });
  }
  throw new Error(`Unexpected external request: ${url.pathname}`);
});

beforeEach(() => {
  accessToken = jwt();
  refreshFailure = undefined;
  vi.stubGlobal("fetch", network);
  backend.query.mockResolvedValue({
    _id: "workspace_test",
    state: "active",
    timeZone: "Asia/Jakarta",
  });
  backend.mutation.mockResolvedValue("workspace_test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function cookieJar() {
  const jar = new Map<string, string>();
  const cookies = {
    get: (name: string) => jar.get(name),
    set: vi.fn((name: string, value: string, _options: unknown) => {
      jar.set(name, value);
    }),
    delete: vi.fn((name: string, _options: unknown) => jar.delete(name)),
  };
  return { jar, cookies };
}
const outcome = async (work: () => unknown) =>
  Promise.resolve()
    .then(work)
    .catch((cause: unknown) => cause);

async function signIn(jar = cookieJar()) {
  const started = await outcome(() =>
    login({
      url: new URL("https://antre.example/login?returnTo=/app/linkedin"),
      cookies: jar.cookies,
    } as never),
  );
  if (!isRedirect(started)) throw new Error("Expected hosted login redirect");
  const url = new URL(started.location);
  const finished = await outcome(() =>
    callback({
      url: new URL(
        `https://antre.example/auth/workos/callback?state=${url.searchParams.get("state")}&code=test_code`,
      ),
      cookies: jar.cookies,
    } as never),
  );
  return { ...jar, started, finished };
}

test("hosted WorkOS login uses PKCE and a single-use state cookie, seals tokens, and validates the session", async () => {
  const { jar, cookies, started, finished } = await signIn();
  const target = new URL(started.location);
  expect(target.origin).toBe("https://api.workos.com");
  expect(target.searchParams.get("provider")).toBe("authkit");
  expect(target.searchParams.get("code_challenge_method")).toBe("S256");
  expect(target.searchParams.get("code_challenge")).toBeTruthy();
  expect(isRedirect(finished) && finished.location).toBe("/app/linkedin");
  expect(jar.has("workos_oauth")).toBe(false);
  const cookie = jar.get("antre_session");
  expect(cookie).toBeTruthy();
  expect(cookie).not.toContain(accessToken);
  expect(cookie).not.toContain("refresh_test");
  expect(cookies.set).toHaveBeenLastCalledWith(
    "antre_session",
    expect.any(String),
    expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    }),
  );
  expect(await readSession(cookie)).toMatchObject({
    userId,
    accessToken,
    sessionId: "session_test",
  });
  if (!cookie) throw new Error("Expected a sealed session");
  const middle = Math.floor(cookie.length / 2);
  expect(
    await readSession(
      cookie.slice(0, middle) +
        (cookie[middle] === "a" ? "b" : "a") +
        cookie.slice(middle + 1),
    ),
  ).toBeNull();
  const reused = await outcome(() =>
    callback({
      url: new URL("https://antre.example/auth/workos/callback?state=x&code=x"),
      cookies,
    } as never),
  );
  expect(isHttpError(reused) && reused.status).toBe(400);
});

test.each(["screen_hint=sign-up", "signup=1"])(
  "signup link %s opens hosted account creation",
  async (query) => {
    const { cookies } = cookieJar();
    const result = await outcome(() =>
      login({
        url: new URL(`https://antre.example/login?${query}`),
        cookies,
      } as never),
    );
    if (!isRedirect(result))
      throw new Error("Expected hosted account creation");
    expect(new URL(result.location).searchParams.get("screen_hint")).toBe(
      "sign-up",
    );
  },
);

test.each(["https://antre.example", "https://antre.monosodiums.test"])(
  "login on %s returns to the same host",
  async (origin) => {
    const { cookies } = cookieJar();
    const result = await outcome(() =>
      login({ url: new URL(`${origin}/login`), cookies } as never),
    );
    if (!isRedirect(result)) throw new Error("Expected hosted login redirect");
    expect(new URL(result.location).searchParams.get("redirect_uri")).toBe(
      `${origin}/auth/workos/callback`,
    );
  },
);

test("new accounts get an empty workspace and the onboarding route", async () => {
  backend.query.mockResolvedValue(null);
  const result = await signIn();
  expect(isRedirect(result.finished) && result.finished.location).toBe(
    "/app/onboarding",
  );
  expect(backend.mutation).toHaveBeenCalledWith(expect.anything(), {});
});

test("state mismatch stops code exchange", async () => {
  const { cookies } = cookieJar();
  await outcome(() =>
    login({ url: new URL("https://antre.example/login"), cookies } as never),
  );
  const result = await outcome(() =>
    callback({
      url: new URL(
        "https://antre.example/auth/workos/callback?state=wrong&code=code",
      ),
      cookies,
    } as never),
  );
  expect(isHttpError(result) && result.status).toBe(400);
  expect(network).not.toHaveBeenCalled();
});

test.each([
  "https://evil.test/app",
  "//evil.test/app",
  "/\\evil.test/app",
  "/auth/delete",
  "javascript:alert(1)",
  "/app\n/invalid",
  "http://[",
])("unsafe return path %s stays in the private app", (path) => {
  expect(safeReturnPath(path)).toBe("/app");
});

test("expired sessions refresh through WorkOS and rotate their encrypted cookie", async () => {
  accessToken = jwt(Math.floor(Date.now() / 1000) - 60);
  const { jar } = await signIn();
  accessToken = jwt();
  const result = await readSession(jar.get("antre_session"));
  expect(result).toMatchObject({
    userId,
    accessToken,
    sealedSession: expect.any(String),
  });
  expect(result?.sealedSession).not.toBe(jar.get("antre_session"));
});

test.each([400, 503])(
  "refresh failure %s fences private access and keeps transient sessions",
  async (status) => {
    accessToken = jwt(Math.floor(Date.now() / 1000) - 60);
    const { jar, cookies } = await signIn();
    refreshFailure = status;
    const result = await outcome(() =>
      handle({
        event: {
          url: new URL("https://antre.example/app"),
          request: new Request("https://antre.example/app"),
          cookies,
          locals: {},
          setHeaders: vi.fn(),
        },
        resolve: vi.fn(),
      } as never),
    );
    if (status === 400) {
      expect(isRedirect(result)).toBe(true);
      expect(jar.has("antre_session")).toBe(false);
    } else {
      expect(isHttpError(result) && result.status).toBe(503);
      expect(jar.has("antre_session")).toBe(true);
    }
  },
);

test("hooks set WorkOS locals, protect app and uploads, and guard writes", async () => {
  const { cookies } = await signIn();
  const locals: App.Locals = {};
  const resolve = vi.fn(async () => new Response("ok"));
  const event = {
    url: new URL("https://antre.example/app/linkedin"),
    request: new Request("https://antre.example/app/linkedin"),
    cookies,
    locals,
    setHeaders: vi.fn(),
  };
  await handle({ event, resolve } as never);
  expect(locals).toMatchObject({
    userId,
    accessToken,
    sessionId: "session_test",
  });
  const crossSite = await outcome(() =>
    handle({
      event: {
        ...event,
        request: new Request(event.url, {
          method: "POST",
          headers: { origin: "https://evil.test" },
        }),
      },
      resolve,
    } as never),
  );
  expect(isHttpError(crossSite) && crossSite.status).toBe(403);
  for (const path of ["/app", "/app/compose", "/upload", "/auth/linkedin"]) {
    const result = await outcome(() =>
      handle({
        event: {
          ...event,
          url: new URL(path, event.url),
          cookies: cookieJar().cookies,
        },
        resolve,
      } as never),
    );
    expect(isRedirect(result) && result.location.startsWith("/login?")).toBe(
      true,
    );
  }
  for (const path of ["/", "/demo", "/privacy"]) {
    expect(
      (
        await handle({
          event: {
            ...event,
            url: new URL(path, event.url),
            cookies: cookieJar().cookies,
          },
          resolve,
        } as never)
      ).status,
    ).toBe(200);
  }
});

test("logout clears the local session and directs the browser to WorkOS logout", async () => {
  const { jar, cookies } = await signIn();
  const result = await outcome(() =>
    logout({ cookies, locals: { sessionId: "session_test" } } as never),
  );
  expect(isRedirect(result)).toBe(true);
  if (!isRedirect(result)) throw new Error("Expected logout redirect");
  const target = new URL(result.location);
  expect(target.origin).toBe("https://api.workos.com");
  expect(target.searchParams.get("session_id")).toBe("session_test");
  expect(jar.has("antre_session")).toBe(false);
});
