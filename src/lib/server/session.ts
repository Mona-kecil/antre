import { createHmac, timingSafeEqual } from "node:crypto";
import * as env from "$app/env/private";
import { z } from "zod";

export const sessionSeconds = 30 * 24 * 60 * 60;
const session = z.object({ userId: z.string().min(1), expires: z.number() });

export function signSession(userId: string) {
  if (!env.SESSION_SECRET) throw new Error("Session signing is not configured");
  const body = Buffer.from(
    JSON.stringify({ userId, expires: Date.now() + sessionSeconds * 1000 }),
  ).toString("base64url");
  const signature = createHmac("sha256", env.SESSION_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function readSession(cookie: string | undefined) {
  if (!cookie || !env.SESSION_SECRET) return null;
  const [body, signature, extra] = cookie.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", env.SESSION_SECRET)
    .update(body)
    .digest();
  const received = Buffer.from(signature, "base64url");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    return null;
  try {
    const result = session.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString()),
    );
    return result.success && result.data.expires > Date.now()
      ? result.data
      : null;
  } catch {
    return null;
  }
}
