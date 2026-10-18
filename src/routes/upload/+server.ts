import { error } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import { validateImage } from "../../../convex/lib/media";
import { convex } from "#lib/server/convex.ts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, fetch }) => {
  const type = request.headers.get("content-type") ?? "";
  const image = await request.blob();
  try {
    validateImage({ contentType: type, size: image.size });
  } catch (cause) {
    error(400, cause instanceof Error ? cause.message : "Invalid image");
  }
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
