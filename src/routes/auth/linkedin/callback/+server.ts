import * as env from "$app/env/private";
import { error, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../../../convex/_generated/api";
import { owner } from "#lib/server/owner.ts";
import { consumeConnection } from "#lib/server/oauth.ts";
import type { RequestHandler } from "./$types";

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().finite(),
  scope: z.string().optional(),
});
const profileSchema = z.object({
  sub: z.string().min(1),
  name: z.string().min(1),
});

export const GET: RequestHandler = async ({ url, cookies, fetch, locals }) => {
  const workspaceId = consumeConnection(cookies, url, locals, "linkedin");
  const { client, secret, workspace } = await owner(locals.userId);
  if (workspace._id !== workspaceId)
    error(400, "Connection workspace changed. Start again from Settings.");
  if (url.searchParams.has("error"))
    redirect(303, "/app/linkedin/settings?connection=cancelled");
  const code = url.searchParams.get("code");
  if (!code) error(400, "LinkedIn did not return an authorization code");
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET)
    error(503, "LinkedIn connection is not configured");
  let profile: z.infer<typeof profileSchema>;
  let token: z.infer<typeof tokenSchema>;
  try {
    const response = await fetch(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: env.LINKEDIN_CLIENT_ID,
          client_secret: env.LINKEDIN_CLIENT_SECRET,
          redirect_uri:
            env.LINKEDIN_REDIRECT_URI || `${url.origin}/auth/linkedin/callback`,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error("Token exchange failed");
    token = tokenSchema.parse(await response.json());
    if (
      token.scope !== undefined &&
      !token.scope.split(/[ ,]+/).includes("w_member_social")
    )
      throw new Error("Publishing permission was not granted");
    const responseProfile = await fetch(
      "https://api.linkedin.com/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!responseProfile.ok) throw new Error("Profile lookup failed");
    profile = profileSchema.parse(await responseProfile.json());
  } catch {
    error(
      502,
      "Could not connect LinkedIn. Enable Share on LinkedIn and OpenID Connect in your developer app, then try again.",
    );
  }
  try {
    await client.action(api.linkedin.connect, {
      secret,
      memberId: profile.sub,
      name: profile.name,
      accessToken: token.access_token,
      tokenExpiresAt: Date.now() + token.expires_in * 1000,
    });
  } catch {
    error(
      403,
      "Could not save this LinkedIn connection. Reconnect the same personal profile.",
    );
  }
  redirect(303, "/app/linkedin/settings?connection=connected");
};
