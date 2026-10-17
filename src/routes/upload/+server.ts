import { error } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import { convex } from "#lib/server/convex.ts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, fetch }) => {
  const type = request.headers.get("content-type") ?? "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(type))
    error(400, "Use a JPEG, PNG, or WebP image");
  const image = await request.blob();
  if (image.size === 0 || image.size > 10 * 1024 * 1024)
    error(400, "Images must be between 1 byte and 10 MB");
  const { client, secret } = convex();
  const url = await client.mutation(api.images.uploadUrl, { secret });
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": type },
    body: image,
  });
  if (!response.ok) error(502, "Image upload failed");
  const result = z
    .object({ storageId: z.string().min(1) })
    .parse(await response.json());
  return Response.json(result);
};
