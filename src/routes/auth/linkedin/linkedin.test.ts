import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import { api } from "../../../../convex/_generated/api";
import { signSession } from "#lib/server/session.ts";
import { GET as start } from "./+server";
import { GET as callback } from "./callback/+server";

const bridge = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("$app/env/private", () => ({
  LINKEDIN_CLIENT_ID: "test-linkedin-app",
  LINKEDIN_CLIENT_SECRET: "test-linkedin-secret",
  LINKEDIN_REDIRECT_URI: "",
  SESSION_SECRET: "test-session-secret",
}));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: "test-secret" }),
}));

beforeEach(() => {
  bridge.query.mockResolvedValue({ threadsUserId: "owner" });
});
afterEach(() => vi.resetAllMocks());

function cookieJar(userId: string | null = "owner") {
  const jar = new Map<string, string>();
  if (userId !== null) jar.set("antre_session", signSession(userId));
  const cookies = {
    get: (name: string) => jar.get(name),
    set: vi.fn((name: string, value: string, _options: unknown) => {
      jar.set(name, value);
    }),
    delete: vi.fn((name: string, _options: unknown) => jar.delete(name)),
  };
  return { jar, cookies };
}

function callbackEvent(
  cookies: ReturnType<typeof cookieJar>["cookies"],
  fetch: typeof globalThis.fetch,
  query = "state=bound-state&code=test-code",
) {
  return {
    url: new URL(`https://antre.example/auth/linkedin/callback?${query}`),
    cookies,
    fetch,
  } as unknown as Parameters<typeof callback>[0];
}

function bindState(jar: Map<string, string>, ownerId = "owner") {
  jar.set("linkedin_state", JSON.stringify({ state: "bound-state", ownerId }));
}

async function outcome(work: () => unknown) {
  return Promise.resolve()
    .then(work)
    .catch((error: unknown) => error);
}

test("LinkedIn connection starts only for the signed-in owner and binds state to that session", async () => {
  const unsigned = cookieJar(null);
  const unsignedResult = await outcome(() =>
    start({
      url: new URL("https://antre.example/auth/linkedin"),
      cookies: unsigned.cookies,
    } as unknown as Parameters<typeof start>[0]),
  );
  expect(isRedirect(unsignedResult) && unsignedResult.location).toBe("/login");
  expect(bridge.query).not.toHaveBeenCalled();
  expect(unsigned.cookies.set).not.toHaveBeenCalled();

  const stranger = cookieJar("stranger");
  const denied = await outcome(() =>
    start({
      url: new URL("https://antre.example/auth/linkedin"),
      cookies: stranger.cookies,
    } as unknown as Parameters<typeof start>[0]),
  );
  expect(isHttpError(denied) && denied.status).toBe(403);
  expect(stranger.cookies.set).not.toHaveBeenCalled();

  const { jar, cookies } = cookieJar();
  const session = jar.get("antre_session");
  const result = await outcome(() =>
    start({
      url: new URL("https://antre.example/auth/linkedin"),
      cookies,
    } as unknown as Parameters<typeof start>[0]),
  );
  expect(isRedirect(result)).toBe(true);
  if (!isRedirect(result))
    throw new Error("Expected LinkedIn authorization redirect");
  const target = new URL(result.location);
  expect(target.origin + target.pathname).toBe(
    "https://www.linkedin.com/oauth/v2/authorization",
  );
  const state = JSON.parse(jar.get("linkedin_state") ?? "null");
  expect(state).toEqual({
    ownerId: "owner",
    state: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(Object.fromEntries(target.searchParams)).toEqual({
    client_id: "test-linkedin-app",
    redirect_uri: "https://antre.example/auth/linkedin/callback",
    response_type: "code",
    scope: "openid profile w_member_social",
    state: state.state,
  });
  expect(cookies.set).toHaveBeenCalledWith(
    "linkedin_state",
    expect.any(String),
    {
      path: "/auth/linkedin/callback",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
    },
  );
  expect(jar.get("antre_session")).toBe(session);
  expect(bridge.mutation).not.toHaveBeenCalled();
});

test.each(["missing", "malformed", "wrong-state", "other-session", "unsigned"])(
  "LinkedIn callback rejects %s state before provider requests and consumes it",
  async (kind) => {
    const { jar, cookies } = cookieJar(
      kind === "unsigned"
        ? null
        : kind === "other-session"
          ? "stranger"
          : "owner",
    );
    if (kind !== "missing") bindState(jar);
    if (kind === "malformed") jar.set("linkedin_state", "invalid JSON");
    const fetch = vi.fn<typeof globalThis.fetch>();
    const event = callbackEvent(
      cookies,
      fetch,
      kind === "wrong-state" ? "state=wrong&code=test-code" : undefined,
    );
    const result = await outcome(() => callback(event));
    expect(isHttpError(result) && result.status).toBe(400);
    expect(jar.has("linkedin_state")).toBe(false);
    expect(cookies.delete).toHaveBeenCalledWith("linkedin_state", {
      path: "/auth/linkedin/callback",
    });
    expect(bridge.query).not.toHaveBeenCalled();
    expect(bridge.mutation).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(cookies.set).not.toHaveBeenCalled();
  },
);

test("LinkedIn callback checks the current owner before token exchange", async () => {
  bridge.query.mockResolvedValue({ threadsUserId: "new-owner" });
  const { jar, cookies } = cookieJar();
  bindState(jar);
  const fetch = vi.fn<typeof globalThis.fetch>();
  const result = await outcome(() => callback(callbackEvent(cookies, fetch)));
  expect(isHttpError(result) && result.status).toBe(403);
  expect(bridge.query).toHaveBeenCalledWith(api.account.current, {
    secret: "test-secret",
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(bridge.mutation).not.toHaveBeenCalled();
  expect(jar.has("linkedin_state")).toBe(false);
});

test.each(["openid profile w_member_social", undefined])(
  "LinkedIn callback stores validated credentials, consumes state once and preserves the owner session (scope %s)",
  async (scope) => {
    const { jar, cookies } = cookieJar();
    const session = jar.get("antre_session");
    bindState(jar);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "test-linkedin-token",
          expires_in: 3600,
          ...(scope === undefined ? {} : { scope }),
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ sub: "member-id", name: "Member Name" }),
      );
    const event = callbackEvent(cookies, fetch);
    const before = Date.now();
    const result = await outcome(() => callback(event));
    expect(isRedirect(result) && result.location).toBe(
      "/linkedin/settings?connection=connected",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetch.mock.calls[0];
    expect(tokenUrl).toBe("https://www.linkedin.com/oauth/v2/accessToken");
    expect(tokenInit?.method).toBe("POST");
    expect(
      Object.fromEntries(new URLSearchParams(String(tokenInit?.body))),
    ).toEqual({
      grant_type: "authorization_code",
      code: "test-code",
      client_id: "test-linkedin-app",
      client_secret: "test-linkedin-secret",
      redirect_uri: "https://antre.example/auth/linkedin/callback",
    });
    expect(fetch.mock.calls[1][0]).toBe("https://api.linkedin.com/v2/userinfo");
    expect(
      new Headers(fetch.mock.calls[1][1]?.headers).get("authorization"),
    ).toBe("Bearer test-linkedin-token");
    expect(bridge.mutation).toHaveBeenCalledWith(api.linkedin.connect, {
      secret: "test-secret",
      memberId: "member-id",
      name: "Member Name",
      accessToken: "test-linkedin-token",
      tokenExpiresAt: expect.any(Number),
    });
    expect(
      bridge.mutation.mock.calls[0][1].tokenExpiresAt,
    ).toBeGreaterThanOrEqual(before + 3600_000);
    expect(jar.get("antre_session")).toBe(session);
    expect(cookies.set).not.toHaveBeenCalled();
    expect(jar.has("linkedin_state")).toBe(false);
    const reused = await outcome(() => callback(event));
    expect(isHttpError(reused) && reused.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bridge.mutation).toHaveBeenCalledTimes(1);
  },
);

test.each([
  { name: "missing access token", token: { expires_in: 3600 }, calls: 1 },
  {
    name: "empty access token",
    token: { access_token: "", expires_in: 3600 },
    calls: 1,
  },
  {
    name: "invalid expiry",
    token: { access_token: "test-token", expires_in: 0 },
    calls: 1,
  },
  {
    name: "string expiry",
    token: { access_token: "test-token", expires_in: "3600" },
    calls: 1,
  },
  {
    name: "missing publishing permission",
    token: {
      access_token: "test-token",
      expires_in: 3600,
      scope: "openid profile",
    },
    calls: 1,
  },
  {
    name: "empty scope",
    token: { access_token: "test-token", expires_in: 3600, scope: "" },
    calls: 1,
  },
  {
    name: "missing profile subject",
    token: { access_token: "test-token", expires_in: 3600 },
    profile: { name: "Member" },
    calls: 2,
  },
  {
    name: "empty profile name",
    token: { access_token: "test-token", expires_in: 3600 },
    profile: { sub: "member", name: "" },
    calls: 2,
  },
])(
  "LinkedIn callback rejects $name without saving credentials",
  async ({ token, profile, calls }) => {
    const { jar, cookies } = cookieJar();
    const session = jar.get("antre_session");
    bindState(jar);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(token))
      .mockResolvedValueOnce(
        Response.json(profile ?? { sub: "member", name: "Member" }),
      );
    const result = await outcome(() => callback(callbackEvent(cookies, fetch)));
    expect(isHttpError(result) && result.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(bridge.mutation).not.toHaveBeenCalled();
    expect(jar.has("linkedin_state")).toBe(false);
    expect(jar.get("antre_session")).toBe(session);
    expect(cookies.set).not.toHaveBeenCalled();
  },
);

test("LinkedIn denial and missing authorization code leave credentials and owner session untouched", async () => {
  const { jar, cookies } = cookieJar();
  const session = jar.get("antre_session");
  const fetch = vi.fn<typeof globalThis.fetch>();
  bindState(jar);
  const denied = await outcome(() =>
    callback(
      callbackEvent(cookies, fetch, "state=bound-state&error=access_denied"),
    ),
  );
  expect(isRedirect(denied) && denied.location).toBe(
    "/linkedin/settings?connection=cancelled",
  );
  bindState(jar);
  const missing = await outcome(() =>
    callback(callbackEvent(cookies, fetch, "state=bound-state")),
  );
  expect(isHttpError(missing) && missing.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
  expect(bridge.mutation).not.toHaveBeenCalled();
  expect(jar.get("antre_session")).toBe(session);
  expect(cookies.set).not.toHaveBeenCalled();
});

test("LinkedIn account mismatch from Convex cannot rewrite the owner session", async () => {
  const { jar, cookies } = cookieJar();
  const session = jar.get("antre_session");
  bindState(jar);
  bridge.mutation.mockRejectedValueOnce(new Error("Another LinkedIn member"));
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ access_token: "test-token", expires_in: 3600 }),
    )
    .mockResolvedValueOnce(
      Response.json({ sub: "other-member", name: "Other Member" }),
    );
  const result = await outcome(() => callback(callbackEvent(cookies, fetch)));
  expect(isHttpError(result) && result.status).toBe(403);
  expect(bridge.mutation).toHaveBeenCalledTimes(1);
  expect(jar.has("linkedin_state")).toBe(false);
  expect(jar.get("antre_session")).toBe(session);
  expect(cookies.set).not.toHaveBeenCalled();
});
