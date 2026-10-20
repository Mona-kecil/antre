import { randomBytes } from "node:crypto";
import * as env from "$app/env/private";
import { error, redirect } from "@sveltejs/kit";
import { owner } from "#lib/server/owner.ts";
import { readSession } from "#lib/server/session.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const session = readSession(cookies.get("antre_session"));
  if (!session) redirect(303, "/login");
  await owner(session.userId);
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET)
    error(503, "LinkedIn connection is not configured");
  const state = randomBytes(32).toString("hex");
  cookies.set(
    "linkedin_state",
    JSON.stringify({ state, ownerId: session.userId }),
    {
      path: "/auth/linkedin/callback",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      maxAge: 600,
    },
  );
  const target = new URL("https://www.linkedin.com/oauth/v2/authorization");
  target.search = new URLSearchParams({
    client_id: env.LINKEDIN_CLIENT_ID,
    redirect_uri:
      env.LINKEDIN_REDIRECT_URI || `${url.origin}/auth/linkedin/callback`,
    response_type: "code",
    scope: "openid profile w_member_social",
    state,
  }).toString();
  redirect(302, target.toString(), { external: ["https://www.linkedin.com"] });
};
