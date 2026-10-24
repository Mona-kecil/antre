import { error } from "@sveltejs/kit";
import { api } from "../../../convex/_generated/api";
import { convex } from "./convex.ts";

export async function owner(userId: string | undefined) {
  if (!userId) error(401, "Sign in to your workspace.");
  const { client, secret } = convex();
  const workspace = await client.query(api.workspaces.current, {});
  if (!workspace || workspace.state !== "active")
    error(403, "This workspace is unavailable.");
  const account = await client.query(api.account.current, { secret });
  return { client, secret, account, workspace };
}

export function reason(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : "";
  return /Uncaught Error: ([^\n]+)/.exec(message)?.[1] ?? fallback;
}
