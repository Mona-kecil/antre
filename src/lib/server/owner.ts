import { error } from "@sveltejs/kit";
import { api } from "../../../convex/_generated/api";
import { convex } from "./convex.ts";

export function requireOwner<A extends { threadsUserId: string }>(
  userId: string,
  account: A | null,
): A {
  if (!account || account.threadsUserId !== userId)
    error(403, "This session does not belong to the owner");
  return account;
}

/** Convex client for the signed-in owner; 403 for any other Threads account. */
export async function owner(userId: string) {
  const { client, secret } = convex();
  const account = requireOwner(
    userId,
    await client.query(api.account.current, { secret }),
  );
  return { client, secret, account };
}

/** Convex's own message in dev ("Uncaught Error: …"); production redacts it. */
export function reason(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : "";
  return /Uncaught Error: ([^\n]+)/.exec(message)?.[1] ?? fallback;
}
