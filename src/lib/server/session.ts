import { WorkOS } from "@workos-inc/node";
import * as env from "$app/env/private";
import { error, type Cookies } from "@sveltejs/kit";

export const sessionCookie = "antre_session";
export const sessionSeconds = 30 * 24 * 60 * 60;

export function workosConfig() {
  if (
    !env.WORKOS_API_KEY ||
    !env.WORKOS_CLIENT_ID ||
    !env.WORKOS_COOKIE_PASSWORD ||
    env.WORKOS_COOKIE_PASSWORD.length < 32
  )
    return null;
  return {
    apiKey: env.WORKOS_API_KEY,
    clientId: env.WORKOS_CLIENT_ID,
    cookiePassword: env.WORKOS_COOKIE_PASSWORD,
  };
}

export function authkit() {
  const config = workosConfig();
  if (!config)
    error(
      503,
      "Login setup is incomplete. Set WORKOS_API_KEY, WORKOS_CLIENT_ID, and WORKOS_COOKIE_PASSWORD (at least 32 characters). You can still try the sample on the home page.",
    );
  const workos = new WorkOS(config.apiKey, {
    clientId: config.clientId,
    issuer: `https://api.workos.com/user_management/${config.clientId}`,
    timeout: 15_000,
    maxRetries: 0,
  });
  return { workos, ...config };
}

export function setSession(cookies: Cookies, url: URL, value: string) {
  cookies.set(sessionCookie, value, {
    path: "/",
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    maxAge: sessionSeconds,
  });
}

export async function readSession(cookie: string | undefined) {
  if (!cookie || !workosConfig()) return null;
  const { workos, cookiePassword } = authkit();
  const session = workos.userManagement.loadSealedSession({
    sessionData: cookie,
    cookiePassword,
  });
  const result = await session.authenticate();
  if (result.authenticated)
    return {
      userId: result.user.id,
      accessToken: result.accessToken,
      sessionId: result.sessionId,
      sealedSession: undefined,
    };
  if (result.reason !== "invalid_jwt") return null;
  const refreshed = await session.refresh();
  if (!refreshed.authenticated) {
    if (refreshed.retryable)
      error(503, "Login service is unavailable. Retry this request.");
    return null;
  }
  const validated = await session.authenticate();
  if (!validated.authenticated) return null;
  return {
    userId: validated.user.id,
    accessToken: validated.accessToken,
    sessionId: validated.sessionId,
    sealedSession: refreshed.sealedSession,
  };
}

export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/app") || /[\\\u0000-\u0020]/.test(value))
    return "/app";
  const target = new URL(value, "https://antre.invalid");
  return target.origin === "https://antre.invalid" &&
    (target.pathname === "/app" || target.pathname.startsWith("/app/"))
    ? `${target.pathname}${target.search}${target.hash}`
    : "/app";
}
