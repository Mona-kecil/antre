import { ConvexHttpClient } from "convex/browser";
import * as env from "$app/env/private";

export function convex() {
  if (!env.CONVEX_URL || !env.ANTRE_SECRET)
    throw new Error("Convex is not configured");
  return {
    client: new ConvexHttpClient(env.CONVEX_URL),
    secret: env.ANTRE_SECRET,
  };
}
