import { api } from "../../../../convex/_generated/api";
import {
  providerClient,
  signedProviderRequest,
} from "#lib/server/providerCallback.ts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
  const signedRequest = await signedProviderRequest(request);
  await providerClient().mutation(api.account.providerCallback, {
    kind: "uninstall",
    signedRequest,
  });
  return new Response("Posting profile disconnected.");
};
