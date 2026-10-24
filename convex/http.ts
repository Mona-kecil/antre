import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { tokenHash } from "./access";
import { MAX_IMAGE_BYTES, validateImage } from "./lib/media";

const http = httpRouter();
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
http.route({
  path: "/assets/upload",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers })),
});
http.route({
  path: "/assets/upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).searchParams.get("token");
    if (!token || token.length > 4096)
      return new Response("Invalid upload", { status: 403, headers });
    try {
      const hash = await tokenHash(token);
      await ctx.runQuery(internal.images.uploadTicket, { hash });
      const contentType = request.headers.get("Content-Type") ?? "";
      const reader = request.body?.getReader();
      if (!reader) throw new Error("Image data required");
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw new Error("Image exceeds 8 MB");
        }
        chunks.push(new Uint8Array(chunk.value));
      }
      validateImage({ contentType, size });
      const blob = new Blob(chunks, { type: contentType });
      const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
      const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
        (b, i) => bytes[i] === b,
      );
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!(contentType === "image/png" ? png : jpeg))
        throw new Error("Image bytes do not match content type");
      const storageId = await ctx.storage.store(blob);
      try {
        await ctx.runMutation(internal.images.finishUpload, {
          hash,
          storageId,
        });
      } catch (error) {
        await ctx.storage.delete(storageId);
        throw error;
      }
      return Response.json({ storageId }, { headers });
    } catch {
      return new Response("Upload rejected or expired", {
        status: 400,
        headers,
      });
    }
  }),
});
export default http;
