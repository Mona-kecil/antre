import { error } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../../convex/_generated/api";
import {
  providerClient,
  signedProviderRequest,
} from "#lib/server/providerCallback.ts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, url }) => {
  const signedRequest = await signedProviderRequest(request);
  const result = z
    .object({ confirmationCode: z.string().min(32) })
    .parse(
      await providerClient().mutation(api.account.providerCallback, {
        kind: "delete",
        signedRequest,
      }),
    );
  const status = new URL("/auth/delete", url.origin);
  status.searchParams.set("code", result.confirmationCode);
  return Response.json({
    url: status.href,
    confirmation_code: result.confirmationCode,
  });
};

export const GET: RequestHandler = async ({ url }) => {
  const confirmationCode = url.searchParams.get("code");
  if (
    !confirmationCode ||
    confirmationCode.length < 32 ||
    confirmationCode.length > 256
  )
    error(404, "Deletion request not found.");
  const result = z
    .object({ status: z.enum(["pending", "complete"]) })
    .nullable()
    .parse(
      await providerClient().query(api.account.deletionStatus, {
        confirmationCode,
      }),
    );
  if (!result) error(404, "Deletion request not found.");
  return new Response(
    result.status === "complete"
      ? "Your requested Antre data has been deleted. Posts published on Threads remain online."
      : "Your Antre data deletion is in progress. Check this address again for its status.",
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
};
