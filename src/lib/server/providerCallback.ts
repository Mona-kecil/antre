import { createHmac, timingSafeEqual } from "node:crypto";
import * as env from "$app/env/private";
import { ConvexHttpClient } from "convex/browser";
import { error } from "@sveltejs/kit";
import { z } from "zod";

const payloadSchema = z.object({
  algorithm: z.literal("HMAC-SHA256"),
  user_id: z.string().min(1),
  issued_at: z.number().int().nonnegative(),
});

export async function signedProviderRequest(request: Request) {
  if (!env.THREADS_APP_SECRET)
    error(503, "Threads callbacks are not configured.");
  const value = (await request.formData()).get("signed_request");
  if (typeof value !== "string" || value.length > 16_384)
    error(400, "Invalid signed request.");
  const [signature, payload, extra] = value.split(".");
  if (
    !signature ||
    !payload ||
    extra !== undefined ||
    !/^[A-Za-z0-9_-]+$/.test(signature) ||
    !/^[A-Za-z0-9_-]+$/.test(payload)
  )
    error(400, "Invalid signed request.");
  const received = Buffer.from(signature, "base64url");
  const expected = createHmac("sha256", env.THREADS_APP_SECRET)
    .update(payload)
    .digest();
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    error(400, "Invalid signed request.");
  try {
    payloadSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch {
    error(400, "Invalid signed request.");
  }
  return value;
}

export function providerClient() {
  if (!env.CONVEX_URL) error(503, "Provider callbacks need CONVEX_URL.");
  // The backend verifies the signed provider proof again; no app or agent authority is granted here.
  return new ConvexHttpClient(env.CONVEX_URL);
}
