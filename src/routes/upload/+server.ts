import { error } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import { validateImage } from "../../../convex/lib/media";
import { owner } from "#lib/server/owner.ts";
import type { RequestHandler } from "./$types";

/** A one-time Convex upload URL, so the browser sends image bytes directly. */
export const GET: RequestHandler = async ({ locals }) => {
  const { client, secret } = await owner(locals.userId);
  return Response.json({
    url: await client.mutation(api.images.uploadUrl, { secret }),
  });
};

export const POST: RequestHandler = async ({ request, fetch, locals }) => {
  const { client, secret } = await owner(locals.userId);
  const type = request.headers.get("content-type") ?? "";
  const declaredSize = Number(request.headers.get("content-length"));
  if (declaredSize > 8 * 1024 * 1024)
    error(413, "Images must be at most 8 MB.");
  const image = await request.blob();
  try {
    validateImage({ contentType: type, size: image.size });
  } catch (cause) {
    error(400, cause instanceof Error ? cause.message : "Invalid image");
  }
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
