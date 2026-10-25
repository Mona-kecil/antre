import * as env from "$app/env/private";
import { error, redirect } from "@sveltejs/kit";
import { owner } from "#lib/server/owner.ts";
import { startConnection } from "#lib/server/oauth.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
  const { workspace } = await owner(locals.userId);
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET)
    error(503, "LinkedIn connection is not configured");
  const state = startConnection(
    cookies,
    url,
    locals,
    workspace._id,
    "linkedin",
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
