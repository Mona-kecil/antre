import { error, redirect } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { readSession } from "#lib/server/session.ts";

export const handle: Handle = async ({ event, resolve }) => {
  event.setHeaders({ "cache-control": "no-store" });
  const path = event.url.pathname;
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(event.request.method) &&
    !["/mcp", "/auth/uninstall", "/auth/delete"].includes(path) &&
    event.request.headers.get("origin") !== event.url.origin
  )
    error(403, "Cross-site writes are forbidden");
  if (
    path === "/login" ||
    path === "/privacy" ||
    path.startsWith("/auth/") ||
    path === "/mcp"
  )
    return resolve(event);
  const session = readSession(event.cookies.get("antre_session"));
  if (!session) redirect(303, "/login");
  event.locals.userId = session.userId;
  return resolve(event);
};
