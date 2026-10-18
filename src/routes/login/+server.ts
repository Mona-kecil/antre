import { randomBytes } from "node:crypto";
import * as env from "$app/env/private";
import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url, cookies }) => {
  if (!env.THREADS_APP_ID)
    error(503, "Set THREADS_APP_ID in Vercel to connect Threads");
  const state = randomBytes(32).toString("hex");
  cookies.set("threads_state", state, {
    path: "/auth/callback",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
  });
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
