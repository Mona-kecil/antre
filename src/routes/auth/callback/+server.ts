import * as env from "$app/env/private";
import { error, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../../convex/_generated/api";
import { owner } from "#lib/server/owner.ts";
import { consumeConnection } from "#lib/server/oauth.ts";
import type { RequestHandler } from "./$types";

const shortToken = z.object({ access_token: z.string().min(1) });
const longToken = shortToken.extend({
  expires_in: z.number().positive().finite(),
});
const profile = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
});

export const GET: RequestHandler = async ({ url, cookies, fetch, locals }) => {
  const workspaceId = consumeConnection(cookies, url, locals, "threads");
  const { client, secret, workspace } = await owner(locals.userId);
  if (workspace._id !== workspaceId)
    error(400, "Connection workspace changed. Start again from Settings.");
  if (url.searchParams.has("error"))
    redirect(303, "/app/settings?connection=cancelled");
  const code = url.searchParams.get("code");
  if (!code) error(400, "Threads did not return an authorization code");
  if (!env.THREADS_APP_ID || !env.THREADS_APP_SECRET)
    error(503, "Threads connection is not configured");
  let account;
  let token;
  try {
    const response = await fetch(
      "https://graph.threads.net/oauth/access_token",
      {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        body: new URLSearchParams({
          client_id: env.THREADS_APP_ID,
          client_secret: env.THREADS_APP_SECRET,
          grant_type: "authorization_code",
          redirect_uri: `${url.origin}/auth/callback`,
          code,
        }),
      },
    );
    if (!response.ok) error(502, "Threads code exchange failed");
    const short = shortToken.parse(await response.json());
    const exchange = new URL("https://graph.threads.net/access_token");
    exchange.search = new URLSearchParams({
      grant_type: "th_exchange_token",
      client_secret: env.THREADS_APP_SECRET,
      access_token: short.access_token,
    }).toString();
    const long = await fetch(exchange, { signal: AbortSignal.timeout(15_000) });
    if (!long.ok) error(502, "Threads token exchange failed");
    token = longToken.parse(await long.json());
    const me = await fetch(
      "https://graph.threads.net/v1.0/me?fields=id,username",
      {
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${token.access_token}` },
      },
    );
    if (!me.ok) error(502, "Threads profile lookup failed");
    account = profile.parse(await me.json());
  } catch {
    error(502, "Could not connect to Threads. Start again from Settings.");
  }
  try {
    await client.action(api.account.connect, {
      secret,
      threadsUserId: account.id,
      username: account.username,
      accessToken: token.access_token,
      tokenExpiresAt: Date.now() + token.expires_in * 1000,
    });
  } catch {
    error(
      403,
      "Could not save this Threads connection. Reconnect the same profile.",
    );
  }
  redirect(303, "/app/settings?connection=connected");
};
