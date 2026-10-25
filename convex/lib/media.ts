import type { Doc } from "../_generated/dataModel";
import type { OwnedQueryCtx as QueryCtx } from "../access";
import { ownedAsset } from "../access";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png"] as const;

export function validateImage(image: { contentType?: string; size: number }) {
  if (!IMAGE_TYPES.some((type) => type === image.contentType))
    throw new Error(
      "Use a JPEG or PNG image. SVG is not accepted; export PNG.",
    );
  if (
    !Number.isSafeInteger(image.size) ||
    image.size < 1 ||
    image.size > MAX_IMAGE_BYTES
  )
    throw new Error("Images must be between 1 byte and 8 MB");
}

export async function partsWithImages(
  ctx: QueryCtx,
  parts: Doc<"posts">["parts"],
) {
  return await Promise.all(
    parts.map(async (part) => {
      if (part.imageId) await ownedAsset(ctx, ctx.workspaceId, part.imageId);
      return {
        ...part,
        ...(part.imageId
          ? { imageUrl: await ctx.storage.getUrl(part.imageId) }
          : {}),
      };
    }),
  );
}
