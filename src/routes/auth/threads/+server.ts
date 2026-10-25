import * as env from "$app/env/private";
import { error, redirect } from "@sveltejs/kit";
import { owner } from "#lib/server/owner.ts";
import { startConnection } from "#lib/server/oauth.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
  const { workspace } = await owner(locals.userId);
  if (!env.THREADS_APP_ID || !env.THREADS_APP_SECRET)
    error(503, "Threads connection is not configured.");
  const state = startConnection(cookies, url, locals, workspace._id, "threads");
  const target = new URL("https://threads.net/oauth/authorize");
  target.search = new URLSearchParams({
    client_id: env.THREADS_APP_ID,
    redirect_uri: `${url.origin}/auth/callback`,
    scope:
      "threads_basic,threads_content_publish,threads_manage_insights,threads_manage_replies,threads_read_replies",
    response_type: "code",
    state,
  }).toString();
  redirect(302, target.toString(), { external: ["https://threads.net"] });
};
