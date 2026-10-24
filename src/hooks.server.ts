import { error, redirect } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import {
  authkit,
  readSession,
  sessionCookie,
  setSession,
} from "#lib/server/session.ts";

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const privatePath =
    path === "/app" ||
    path.startsWith("/app/") ||
    path === "/upload" ||
    path === "/logout" ||
    path === "/auth/threads" ||
    path === "/auth/callback" ||
    path === "/auth/linkedin" ||
    path === "/auth/linkedin/callback";
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(event.request.method) &&
    !["/mcp", "/auth/uninstall", "/auth/delete"].includes(path) &&
    event.request.headers.get("origin") !== event.url.origin
  )
    error(403, "Cross-site writes are forbidden");
  if (privatePath) {
    event.setHeaders({ "cache-control": "no-store" });
    authkit();
    let session;
    try {
      session = await readSession(event.cookies.get(sessionCookie));
    } catch {
      error(503, "Login service is unavailable. Retry this request.");
    }
    if (!session) {
      event.cookies.delete(sessionCookie, { path: "/" });
      redirect(
        303,
        `/login?returnTo=${encodeURIComponent(path + event.url.search)}`,
      );
    }
    if (session.sealedSession)
      setSession(event.cookies, event.url, session.sealedSession);
    event.locals.userId = session.userId;
    event.locals.accessToken = session.accessToken;
    event.locals.sessionId = session.sessionId;
  } else if (
    path === "/login" ||
    path.startsWith("/auth/") ||
    path === "/mcp"
  ) {
    event.setHeaders({ "cache-control": "no-store" });
  }
  return resolve(event);
};
