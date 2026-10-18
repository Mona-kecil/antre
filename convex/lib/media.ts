import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

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
    parts.map(async (part) => ({
      ...part,
      ...(part.imageId
        ? { imageUrl: await ctx.storage.getUrl(part.imageId) }
        : {}),
    })),
  );
}
