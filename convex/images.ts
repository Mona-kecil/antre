import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { withSecret } from "./auth";
import { validateImage } from "./lib/media";

export const uploadUrl = mutation(
  withSecret(
    {},
    async (ctx: MutationCtx) => await ctx.storage.generateUploadUrl(),
  ),
);

export const preview = query(
  withSecret(
    { imageId: v.id("_storage") },
    async (ctx: QueryCtx, { imageId }) => {
      const image = await ctx.db.system.get(imageId);
      if (!image) throw new Error("Image not found in storage");
      validateImage(image);
      const previewUrl = await ctx.storage.getUrl(imageId);
      if (!previewUrl) throw new Error("Image not found in storage");
      return { imageId, previewUrl };
    },
  ),
);
