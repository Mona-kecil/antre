import { afterEach, expect, test, vi } from "vitest";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import { GET as login } from "../login/+server";
import { GET as callback } from "./callback/+server";
import { handle } from "../../hooks.server";
import { readSession, signSession } from "#lib/server/session.ts";

const { mutation } = vi.hoisted(() => ({ mutation: vi.fn() }));
vi.mock("$app/env/private", () => ({
  THREADS_APP_ID: "app",
  THREADS_APP_SECRET: "test-app-secret",
  SESSION_SECRET: "test-session-secret",
}));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: { mutation }, secret: "test-secret" }),
}));

afterEach(() => vi.clearAllMocks());

test("login binds state, exchanges three Threads requests, sets a signed owner session, and rejects bad state or another owner", async () => {
  const resolve = vi.fn(async () => new Response("OK"));
  const requestEvent = {
    url: new URL("https://antre.example/auth/delete"),
    request: new Request("https://antre.example/auth/delete", {
      method: "POST",
      body: new URLSearchParams({ signed_request: "test" }),
    }),
    setHeaders: vi.fn(),
  };
  expect(
    (
      await handle({ event: requestEvent, resolve } as unknown as Parameters<
        typeof handle
      >[0])
    ).status,
  ).toBe(200);
  const crossSite = await Promise.resolve()
    .then(() =>
      handle({
        event: { ...requestEvent, url: new URL("https://antre.example/") },
        resolve,
      } as unknown as Parameters<typeof handle>[0]),
    )
    .catch((error: unknown) => error);
  expect(isHttpError(crossSite) && crossSite.status).toBe(403);
  const jar = new Map<string, string>();
  const set = vi.fn((name: string, value: string) => {
    jar.set(name, value);
  });
  const cookies = {
    get: (name: string) => jar.get(name),
    set,
    delete: (name: string) => jar.delete(name),
  };
  const url = new URL("https://antre.example/login");
  const redirect = await Promise.resolve()
    .then(() =>
      login({ url, cookies } as unknown as Parameters<typeof login>[0]),
    )
    .catch((error: unknown) => error);
  expect(isRedirect(redirect)).toBe(true);
  if (!isRedirect(redirect)) throw new Error("Expected login redirect");
  const authorize = new URL(redirect.location);
  expect(authorize.origin + authorize.pathname).toBe(
    "https://threads.net/oauth/authorize",
  );
  expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
    client_id: "app",
    redirect_uri: "https://antre.example/auth/callback",
    scope: "threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies",
    response_type: "code",
    state: jar.get("threads_state"),
  });
  const state = jar.get("threads_state");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "short-test-token" }))
    .mockResolvedValueOnce(
      Response.json({ access_token: "long-test-token", expires_in: 5184000 }),
    )
    .mockResolvedValueOnce(Response.json({ id: "owner", username: "mona" }));
  const event = {
    url: new URL(
      `https://antre.example/auth/callback?code=code&state=${state}`,
    ),
    cookies,
    fetch,
  } as unknown as Parameters<typeof callback>[0];
  const outcome = await Promise.resolve(callback(event)).catch(
    (error: unknown) => error,
  );
  expect(isRedirect(outcome) && outcome.location).toBe("/");
  expect(fetch).toHaveBeenCalledTimes(3);
  const [tokenUrl, tokenInit] = fetch.mock.calls[0];
  expect(tokenUrl).toBe("https://graph.threads.net/oauth/access_token");
  expect(tokenInit?.method).toBe("POST");
  expect(
    Object.fromEntries(new URLSearchParams(String(tokenInit?.body))),
  ).toEqual({
    client_id: "app",
    client_secret: "test-app-secret",
    grant_type: "authorization_code",
    redirect_uri: "https://antre.example/auth/callback",
    code: "code",
  });
  expect(
    new URL(String(fetch.mock.calls[1][0])).searchParams.get("grant_type"),
  ).toBe("th_exchange_token");
  expect(String(fetch.mock.calls[2][0])).toBe(
    "https://graph.threads.net/v1.0/me?fields=id,username",
  );
  expect(mutation).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      threadsUserId: "owner",
      accessToken: "long-test-token",
    }),
  );
  expect(set).toHaveBeenCalledWith(
    "antre_session",
    expect.any(String),
    expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    }),
  );
  expect(readSession(jar.get("antre_session"))?.userId).toBe("owner");
  expect(readSession(jar.get("antre_session") + "tamper")).toBeNull();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 31 * 86400000);
  expect(readSession(jar.get("antre_session"))).toBeNull();
  vi.restoreAllMocks();
  expect(readSession(signSession("owner"))?.userId).toBe("owner");
  jar.set("threads_state", "correct");
  const rejected = await Promise.resolve(
    callback({
      ...event,
      url: new URL("https://antre.example/auth/callback?state=wrong&code=code"),
    }),
  ).catch((error: unknown) => error);
  expect(isHttpError(rejected) && rejected.status).toBe(400);
  expect(fetch).toHaveBeenCalledTimes(3);
  jar.set("threads_state", state ?? "");
  fetch
    .mockResolvedValueOnce(Response.json({ access_token: "short-test-token" }))
    .mockResolvedValueOnce(
      Response.json({ access_token: "long-test-token", expires_in: 5184000 }),
    )
    .mockResolvedValueOnce(Response.json({ id: "other", username: "other" }));
  mutation.mockRejectedValueOnce(new Error("Another owner"));
  const denied = await Promise.resolve(callback(event)).catch(
    (error: unknown) => error,
  );
  expect(isHttpError(denied) && denied.status).toBe(403);
  expect(
    set.mock.calls.filter(([name]) => name === "antre_session"),
  ).toHaveLength(1);
});
