import { ownedTables as cleanupTables } from "./ownership";
export { ownedTables as cleanupTables } from "./ownership";
import { v } from "convex/values";
import { DEFAULT_TIME_ZONE, validateTimeZone } from "../src/lib/timezone";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { OwnedMutationCtx, OwnedQueryCtx } from "./access";
import { ownedRow, resolveAccess } from "./access";
import { ownerMutation, ownerQuery } from "./auth";

export const ensure = mutation({
  args: { timeZone: v.optional(v.string()) },
  handler: async (ctx, { timeZone }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    let user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    if (!user) {
      const id = await ctx.db.insert("users", {
        subject: identity.subject,
        tokenIdentifier: identity.tokenIdentifier,
      });
      user = await ctx.db.get(id);
    }
    if (!user) throw new Error("User not found");
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .unique();
    if (existing) {
      if (existing.state !== "active") throw new Error("Workspace unavailable");
      return existing;
    }
    const id = await ctx.db.insert("workspaces", {
      ownerId: user._id,
      state: "active",
      timeZone: validateTimeZone(timeZone ?? DEFAULT_TIME_ZONE),
    });
    return await ctx.db.get(id);
  },
});
export const current = query({
  args: { secret: v.optional(v.string()) },
  handler: async (ctx, { secret }) => {
    if (secret !== undefined) {
      const access = await resolveAccess(ctx, secret);
      return await ctx.db.get(access.workspaceId);
    }
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    if (!user) return null;
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .unique();
    if (!workspace) return null;
    if (workspace.state !== "active") throw new Error("Workspace unavailable");
    return workspace;
  },
});
function userOnly(ctx: OwnedMutationCtx) {
  if (ctx.via !== "user") throw new Error("User session required");
}
export const updateTimeZone = ownerMutation(
  { timeZone: v.string() },
  async (ctx: OwnedMutationCtx, { timeZone }) => {
    userOnly(ctx);
    await ctx.db.patch(ctx.workspaceId, {
      timeZone: validateTimeZone(timeZone),
    });
  },
);
export const createAgentGrant = ownerMutation(
  { label: v.string(), tokenHash: v.string() },
  async (ctx: OwnedMutationCtx, { label, tokenHash }) => {
    userOnly(ctx);
    if (
      !label.trim() ||
      label.length > 100 ||
      !/^[a-f0-9]{64}$/.test(tokenHash)
    )
      throw new Error("Invalid agent grant");
    if (
      await ctx.db
        .query("agentGrants")
        .withIndex("by_hash", (q) => q.eq("hash", tokenHash))
        .first()
    )
      throw new Error("Credential already registered");
    const grants = await ctx.db
      .query("agentGrants")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
      .collect();
    if (grants.filter((g) => g.revokedAt === undefined).length >= 20)
      throw new Error("Agent grant limit reached");
    return await ctx.db.insert("agentGrants", {
      workspaceId: ctx.workspaceId,
      label: label.trim(),
      hash: tokenHash,
    });
  },
);
export const listAgentGrants = ownerQuery({}, async (ctx: OwnedQueryCtx) => {
  if (ctx.via !== "user") throw new Error("User session required");
  const grants = await ctx.db
    .query("agentGrants")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
    .collect();
  return grants.map(({ hash: _hash, ...grant }) => grant);
});
export const revokeAgentGrant = ownerMutation(
  { id: v.id("agentGrants") },
  async (ctx: OwnedMutationCtx, { id }) => {
    userOnly(ctx);
    const grant = await ownedRow(ctx, id);
    if (grant.revokedAt === undefined)
      await ctx.db.patch(id, { revokedAt: Date.now() });
  },
);
export async function disconnectChannel(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  channel: "threads" | "linkedin",
) {
  if (channel === "threads") {
    const account = await ctx.db
      .query("account")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    if (account)
      await ctx.db.patch(account._id, {
        accessToken: "",
        needsReconnect: true,
      });
  } else {
    const account = await ctx.db
      .query("linkedinAccount")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    if (account)
      await ctx.db.patch(account._id, {
        accessToken: "",
        needsReconnect: true,
      });
  }
}
export const disconnect = ownerMutation(
  { channel: v.union(v.literal("threads"), v.literal("linkedin")) },
  async (ctx: OwnedMutationCtx, { channel }) => {
    userOnly(ctx);
    await disconnectChannel(ctx, ctx.workspaceId, channel);
  },
);
export async function beginDeletion(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.state === "deleting") return;
  await ctx.db.patch(workspaceId, { state: "deleting" });
  await disconnectChannel(ctx, workspaceId, "threads");
  await disconnectChannel(ctx, workspaceId, "linkedin");
  for (const table of ["posts", "linkedinPosts"] as const) {
    const posts = (
      await Promise.all(
        (["queued", "publishing"] as const).map((kind) =>
          ctx.db
            .query(table)
            .withIndex("workspace_by_kind_at", (q) =>
              q.eq("workspaceId", workspaceId).eq("status.kind", kind),
            )
            .collect(),
        ),
      )
    ).flat();
    for (const post of posts) {
      if (post.status.kind === "queued")
        await ctx.scheduler.cancel(post.status.jobId);
      if (
        post.status.kind === "publishing" &&
        "retryJobId" in post.status &&
        post.status.retryJobId
      )
        await ctx.scheduler.cancel(post.status.retryJobId);
    }
  }
  // Allow dispatched requests to record receipts before removing their rows.
  await ctx.scheduler.runAfter(15 * 60_000, internal.workspaces.cleanup, {
    workspaceId,
  });
}
export const deleteWorkspace = ownerMutation(
  {},
  async (ctx: OwnedMutationCtx) => {
    userOnly(ctx);
    await beginDeletion(ctx, ctx.workspaceId);
  },
);
export const cleanup = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace || workspace.state !== "deleting") return;
    let count = 0;
    for (const table of cleanupTables) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .take(50);
      for (const row of rows) {
        if ("status" in row) {
          if (row.status.kind === "queued")
            await ctx.scheduler.cancel(row.status.jobId);
          if (
            row.status.kind === "publishing" &&
            "retryJobId" in row.status &&
            row.status.retryJobId
          )
            await ctx.scheduler.cancel(row.status.retryJobId);
        }
        if ("storageId" in row) await ctx.storage.delete(row.storageId);
        await ctx.db.delete(row._id);
        count++;
      }
    }
    if (count)
      await ctx.scheduler.runAfter(0, internal.workspaces.cleanup, {
        workspaceId,
      });
    else {
      for (const receipt of await ctx.db
        .query("providerReceipts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect())
        await ctx.db.patch(receipt._id, {
          status: "complete",
          workspaceId: undefined,
        });
      await ctx.db.delete(workspace.ownerId);
      await ctx.db.delete(workspaceId);
    }
  },
});
