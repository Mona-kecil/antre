import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  activeWorkspace,
  ownedAsset,
  tokenHash,
  type OwnedActionCtx,
  type OwnedMutationCtx,
  type OwnedQueryCtx,
} from "./access";
import { ownerAction, ownerMutation, ownerQuery } from "./auth";
import { MAX_IMAGE_BYTES, validateImage } from "./lib/media";

export const register = internalMutation({
  args: { workspaceId: v.id("workspaces"), storageId: v.id("_storage") },
  handler: async (ctx, { workspaceId, storageId }) => {
    await activeWorkspace(ctx, workspaceId);
    const image = await ctx.db.system.get(storageId);
    if (!image) throw new Error("Image not found");
    validateImage(image);
    const existing = await ctx.db
      .query("assets")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .unique();
    if (existing) throw new Error("Image already registered");
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(501);
    if (assets.length >= 500) throw new Error("Asset limit reached");
    return await ctx.db.insert("assets", { workspaceId, storageId });
  },
});
export const ingest = ownerAction(
  { bytesBase64: v.string(), contentType: v.string() },
  async (
    ctx: OwnedActionCtx,
    { bytesBase64, contentType },
  ): Promise<{ imageId: Id<"_storage">; previewUrl: string }> => {
    if (bytesBase64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
      throw new Error("Image exceeds 8 MB");
    let raw: string;
    try {
      raw = atob(bytesBase64);
    } catch {
      throw new Error("Invalid image data");
    }
    validateImage({ contentType, size: raw.length });
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
      (b, i) => bytes[i] === b,
    );
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!(contentType === "image/png" ? png : jpeg))
      throw new Error("Image bytes do not match content type");
    const imageId = await ctx.storage.store(
      new Blob([bytes], { type: contentType }),
    );
    try {
      await ctx.runMutation(internal.images.register, {
        workspaceId: ctx.workspaceId,
        storageId: imageId,
      });
    } catch (error) {
      await ctx.storage.delete(imageId);
      throw error;
    }
    const previewUrl = await ctx.storage.getUrl(imageId);
    if (!previewUrl) throw new Error("Image not found");
    return { imageId, previewUrl };
  },
);
export const preview = ownerQuery(
  { imageId: v.id("_storage") },
  async (ctx: OwnedQueryCtx, { imageId }) => {
    await ownedAsset(ctx, ctx.workspaceId, imageId);
    const image = await ctx.db.system.get(imageId);
    if (!image) throw new Error("Image not found in storage");
    validateImage(image);
    const previewUrl = await ctx.storage.getUrl(imageId);
    if (!previewUrl) throw new Error("Image not found");
    return { imageId, previewUrl };
  },
);
export const remove = ownerMutation(
  { imageId: v.id("_storage") },
  async (ctx: OwnedMutationCtx, { imageId }) => {
    const asset = await ownedAsset(ctx, ctx.workspaceId, imageId);
    const attached = await ctx.db
      .query("posts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
      .collect();
    if (
      attached.some((post) =>
        post.parts.some((part) => part.imageId === imageId),
      )
    )
      throw new Error("Image is attached to a post");
    await ctx.storage.delete(imageId);
    await ctx.db.delete(asset._id);
  },
);

export const uploadUrl = ownerMutation({}, async (ctx: OwnedMutationCtx) => {
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new Error("CONVEX_SITE_URL is required for image uploads");
  const assets = await ctx.db
    .query("assets")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
    .take(501);
  if (assets.length >= 500) throw new Error("Asset limit reached");
  const tickets = await ctx.db
    .query("assetUploads")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
    .collect();
  for (const ticket of tickets)
    if (ticket.expiresAt <= Date.now()) await ctx.db.delete(ticket._id);
  if (tickets.filter((ticket) => ticket.expiresAt > Date.now()).length >= 20)
    throw new Error("Upload limit reached");
  // The storage service issues the opaque upload capability; it never proves ownership of a supplied ID.
  const token = await tokenHash(await ctx.storage.generateUploadUrl());
  await ctx.db.insert("assetUploads", {
    workspaceId: ctx.workspaceId,
    hash: await tokenHash(token),
    expiresAt: Date.now() + 10 * 60_000,
  });
  return `${site}/assets/upload?token=${encodeURIComponent(token)}`;
});
export const uploadTicket = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const ticket = await ctx.db
      .query("assetUploads")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!ticket || ticket.expiresAt <= Date.now())
      throw new Error("Upload expired");
    await activeWorkspace(ctx, ticket.workspaceId);
    return ticket.workspaceId;
  },
});
export const finishUpload = internalMutation({
  args: { hash: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { hash, storageId }) => {
    const ticket = await ctx.db
      .query("assetUploads")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!ticket || ticket.expiresAt <= Date.now())
      throw new Error("Upload expired");
    await activeWorkspace(ctx, ticket.workspaceId);
    const image = await ctx.db.system.get(storageId);
    if (!image) throw new Error("Image not found");
    validateImage(image);
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ticket.workspaceId))
      .take(501);
    if (assets.length >= 500) throw new Error("Asset limit reached");
    if (
      await ctx.db
        .query("assets")
        .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
        .first()
    )
      throw new Error("Image already registered");
    await ctx.db.insert("assets", {
      workspaceId: ticket.workspaceId,
      storageId,
    });
    await ctx.db.delete(ticket._id);
  },
});
