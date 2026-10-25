import { ConvexHttpClient } from "convex/browser";
import { getRequestEvent } from "$app/server";
import * as env from "$app/env/private";
import { error } from "@sveltejs/kit";

export function authenticatedConvex(accessToken: string) {
  if (!env.CONVEX_URL)
    error(503, "Private workspace setup is incomplete: set CONVEX_URL.");
  const client = new ConvexHttpClient(env.CONVEX_URL);
  client.setAuth(accessToken);
  return { client, secret: undefined };
}

export function convex() {
  const { locals } = getRequestEvent();
  if (!locals.userId || !locals.accessToken)
    error(401, "Sign in to your workspace.");
  return authenticatedConvex(locals.accessToken);
}

export function agentConvex(token: string) {
  if (!env.CONVEX_URL)
    error(503, "Private workspace setup is incomplete: set CONVEX_URL.");
  return { client: new ConvexHttpClient(env.CONVEX_URL), secret: token };
}
