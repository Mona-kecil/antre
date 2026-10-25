import { v } from "convex/values";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import {
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

export type Access = { workspaceId: Id<"workspaces">; via: "user" | "agent" };
export type OwnedQueryCtx = QueryCtx & Access;
export type OwnedMutationCtx = MutationCtx & Access;
export type OwnedActionCtx = ActionCtx & Access;
export async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function activeWorkspace(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
) {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.state !== "active")
    throw new Error("Workspace unavailable");
  return workspace;
}
export async function workspaceContext<C extends QueryCtx>(
  ctx: C,
  workspaceId: Id<"workspaces">,
): Promise<C & Access> {
  const workspace = await activeWorkspace(ctx, workspaceId);
  return { ...ctx, workspaceId: workspace._id, via: "user" };
}
export async function resolveAccess(
  ctx: QueryCtx,
  secret?: string,
): Promise<Access> {
  let workspaceId: Id<"workspaces"> | undefined;
  let via: Access["via"] = "user";
  if (secret !== undefined) {
    const hash = await tokenHash(secret);
    const credential = await ctx.db
      .query("agentGrants")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!credential || credential.revokedAt !== undefined)
      throw new Error("Unauthorized");
    workspaceId = credential.workspaceId;
    via = "agent";
  } else {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    const workspace =
      user &&
      (await ctx.db
        .query("workspaces")
        .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
        .unique());
    workspaceId = workspace?._id;
  }
  if (!workspaceId)
    throw new Error("Workspace not found; call workspaces.ensure");
  await activeWorkspace(ctx, workspaceId);
  return { workspaceId, via };
}
export const resolve = internalQuery({
  args: { secret: v.optional(v.string()) },
  handler: (ctx, { secret }): Promise<Access> => resolveAccess(ctx, secret),
});
export async function ownedRow<T extends TableNames>(
  ctx: OwnedQueryCtx,
  id: Id<T>,
): Promise<Doc<T>> {
  const row = await ctx.db.get(id);
  if (!row || !("workspaceId" in row) || row.workspaceId !== ctx.workspaceId)
    throw new Error("Not found");
  return row;
}
export async function ownedAsset(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  storageId: Id<"_storage">,
) {
  const asset = await ctx.db
    .query("assets")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .unique();
  if (!asset || asset.workspaceId !== workspaceId)
    throw new Error("Image not found");
  return asset;
}

export async function connectionActive(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  expectedToken?: string,
) {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.state !== "active")
    return null;
  const account = await ctx.db
    .query("account")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  if (
    !account ||
    !account.accessToken ||
    account.needsReconnect ||
    account.tokenExpiresAt <= Date.now() ||
    (expectedToken !== undefined && account.accessToken !== expectedToken)
  )
    return null;
  return account;
}

export const background = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    expectedToken: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, expectedToken }): Promise<Access> => {
    await activeWorkspace(ctx, workspaceId);
    if (
      expectedToken !== undefined &&
      !(await connectionActive(ctx, workspaceId, expectedToken))
    )
      throw new Error("Connection changed");
    return { workspaceId, via: "user" };
  },
});
