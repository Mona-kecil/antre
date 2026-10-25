import { redirect } from "@sveltejs/kit";
import { authkit, sessionCookie } from "#lib/server/session.ts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = ({ locals, cookies }) => {
  const { workos } = authkit();
  const target = locals.sessionId
    ? workos.userManagement.getLogoutUrl({ sessionId: locals.sessionId })
    : "/";
  cookies.delete(sessionCookie, { path: "/" });
  cookies.delete("linkedin_state", { path: "/auth/linkedin/callback" });
  cookies.delete("threads_state", { path: "/auth/callback" });
  redirect(303, target, { external: ["https://api.workos.com"] });
};
