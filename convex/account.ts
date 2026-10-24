import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { OwnedQueryCtx as QueryCtx } from "./access";
import { tokenHash, workspaceContext, type OwnedActionCtx } from "./access";
import { ownerAction, ownerQuery } from "./auth";
import { accountState, releaseHeld } from "./lib/scheduling";
import { threads } from "./publishing";
import { beginDeletion, disconnectChannel } from "./workspaces";

const connectionArgs = {
  threadsUserId: v.string(),
  username: v.string(),
  accessToken: v.string(),
  tokenExpiresAt: v.number(),
};
export const connect = ownerAction(
  connectionArgs,
  async (ctx: OwnedActionCtx, args): Promise<void> => {
    if (ctx.via !== "user") throw new Error("User session required");
    if (
      !Number.isFinite(args.tokenExpiresAt) ||
      args.tokenExpiresAt <= Date.now()
    )
      throw new Error("Token must expire in the future");
    let profile: { id: string; username: string };
    try {
      profile = z
        .object({ id: z.string().min(1), username: z.string().min(1) })
        .parse(
          await threads("me", args.accessToken, { fields: "id,username" }),
        );
    } catch {
      throw new Error("Threads token could not be verified");
    }
    if (profile.id !== args.threadsUserId)
      throw new Error("Threads token identity does not match");
    await ctx.runMutation(internal.account.attach, {
      workspaceId: ctx.workspaceId,
      ...args,
      threadsUserId: profile.id,
      username: profile.username,
    });
  },
);
export const attach = internalMutation({
  args: { ...connectionArgs, workspaceId: v.id("workspaces") },
  handler: async (base, args) => {
    const ctx = await workspaceContext(base, args.workspaceId);
    if (
      !Number.isFinite(args.tokenExpiresAt) ||
      args.tokenExpiresAt <= Date.now()
    )
      throw new Error("Token must expire in the future");
    const existingRemote = await ctx.db
      .query("account")
      .withIndex("by_remote", (q) => q.eq("threadsUserId", args.threadsUserId))
      .unique();
    if (existingRemote && existingRemote.workspaceId !== ctx.workspaceId)
      throw new Error("Platform account already connected");
    const account = await ctx.db
      .query("account")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
      .unique();
    if (account && account.threadsUserId !== args.threadsUserId)
      throw new Error("This app belongs to another Threads account");
    const value = {
      threadsUserId: args.threadsUserId,
      username: args.username,
      accessToken: args.accessToken,
      tokenExpiresAt: args.tokenExpiresAt,
      needsReconnect: false,
      lastRefreshError: undefined,
      lastRefreshErrorAt: undefined,
    };
    if (account) await ctx.db.patch(account._id, value);
    else
      await ctx.db.insert("account", {
        ...value,
        workspaceId: ctx.workspaceId,
      });
    await releaseHeld(ctx);
  },
});

export const current = ownerQuery({}, async (ctx: QueryCtx) => {
  const account = await ctx.db
    .query("account")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
    .unique();
  return accountState(account);
});

function base64url(value: string) {
  const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(raw, (byte) => byte.charCodeAt(0));
}
async function verifiedProviderUser(signedRequest: string) {
  const secret = process.env.THREADS_APP_SECRET;
  if (!secret) throw new Error("Threads callbacks are not configured");
  try {
    if (signedRequest.length > 16384) throw new Error("Invalid request");
    const [signature, encoded, extra] = signedRequest.split(".");
    if (
      !signature ||
      !encoded ||
      extra !== undefined ||
      !/^[A-Za-z0-9_-]+$/.test(signature) ||
      !/^[A-Za-z0-9_-]+$/.test(encoded)
    )
      throw new Error("Invalid request");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64url(signature),
      new TextEncoder().encode(encoded),
    );
    if (!valid) throw new Error("Invalid signature");
    const payload = z
      .object({
        algorithm: z.literal("HMAC-SHA256"),
        user_id: z.string().min(1),
        issued_at: z.number().int().nonnegative(),
      })
      .parse(JSON.parse(new TextDecoder().decode(base64url(encoded))));
    if (payload.issued_at * 1000 > Date.now() + 5 * 60_000)
      throw new Error("Invalid timestamp");
    return payload.user_id;
  } catch {
    throw new Error("Invalid signed request");
  }
}
export const providerCallback = mutation({
  args: {
    kind: v.union(v.literal("delete"), v.literal("uninstall")),
    signedRequest: v.string(),
  },
  handler: async (ctx, { kind, signedRequest }) => {
    const remoteId = await verifiedProviderUser(signedRequest);
    const confirmationCode = await tokenHash(`${kind}:${signedRequest}`);
    const hash = await tokenHash(confirmationCode);
    const existing = await ctx.db
      .query("providerReceipts")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (existing) return { confirmationCode };
    const account = await ctx.db
      .query("account")
      .withIndex("by_remote", (q) => q.eq("threadsUserId", remoteId))
      .unique();
    if (account?.workspaceId) {
      const workspaceId = account.workspaceId;
      await disconnectChannel(ctx, workspaceId, "threads");
      const grants = await ctx.db
        .query("agentGrants")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      for (const grant of grants)
        if (grant.revokedAt === undefined)
          await ctx.db.patch(grant._id, { revokedAt: Date.now() });
      if (kind === "delete") {
        await beginDeletion(ctx, workspaceId);
        await ctx.db.insert("providerReceipts", {
          hash,
          workspaceId,
          status: "pending",
          expiresAt: Date.now() + 30 * 86_400_000,
        });
        return { confirmationCode };
      }
    }
    await ctx.db.insert("providerReceipts", {
      hash,
      status: "complete",
      expiresAt: Date.now() + 30 * 86_400_000,
    });
    return { confirmationCode };
  },
});
export const deletionStatus = query({
  args: { confirmationCode: v.string() },
  handler: async (ctx, { confirmationCode }) => {
    if (!/^[a-f0-9]{64}$/.test(confirmationCode)) return null;
    const hash = await tokenHash(confirmationCode);
    const receipt = await ctx.db
      .query("providerReceipts")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!receipt || receipt.expiresAt <= Date.now()) return null;
    return { status: receipt.status };
  },
});
