import { timingSafeEqual } from "node:crypto";
import * as env from "$app/env/private";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convex } from "#lib/server/convex.ts";
import { wib } from "#lib/time.ts";
import { IMAGE_TYPES } from "../../../convex/lib/media";
import { decodeImage, downloadImage, MAX_IMAGE_BASE64_LENGTH } from "./images";
import type { RequestHandler } from "./$types";

const id = z
  .string()
  .min(1)
  .transform((value) => value as Id<"posts">);
const parts = z
  .array(
    z.object({
      text: z
        .string()
        .refine(
          (text) => text.trim().length > 0 && [...text].length <= 500,
          "Use 1–500 characters",
        ),
      imageId: z
        .string()
        .min(1)
        .optional()
        .transform((value) => value as Id<"_storage"> | undefined),
    }),
  )
  .min(1);
const meta = z
  .object({
    topic: z.string().optional(),
    angle: z.string().optional(),
    format: z.string().optional(),
    hook: z.string().optional(),
    notes: z.string().optional(),
  })
  .optional();

const dimension = z.enum(["topic", "angle", "format"]);
const dateRange = {
  since: z
    .union([z.iso.date(), z.iso.datetime({ offset: true, local: true })])
    .optional(),
  until: z
    .union([z.iso.date(), z.iso.datetime({ offset: true, local: true })])
    .optional(),
};

function result(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value ?? { ok: true }, (key, item) =>
          [
            "at",
            "startedAt",
            "heldAt",
            "retryAt",
            "tokenExpiresAt",
            "lastRefreshErrorAt",
            "_creationTime",
          ].includes(key) && typeof item === "number"
            ? { iso: new Date(item).toISOString(), wib: wib(item) }
            : item,
        ),
      },
    ],
  };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "upload_image",
      {
        description:
          "Upload a JPEG or PNG image (1 byte–8 MB) from exactly one public HTTP(S) url or raw base64 + contentType. URL downloads time out after 10 seconds. Vercel caps request bodies near 4.5 MB, so for base64 images over about 3 MB use image_upload_url instead. Returns imageId and previewUrl; use imageId in a create_draft/update_draft part, then verify with search_posts fullParts=true or list_queue. SVG is not accepted; export PNG.",
        inputSchema: z
          .strictObject({
            url: z.url({ protocol: /^https?$/ }).optional(),
            base64: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH).optional(),
            contentType: z.enum(IMAGE_TYPES).optional(),
          })
          .refine(
            (input) =>
              input.url !== undefined
                ? input.base64 === undefined && input.contentType === undefined
                : input.base64 !== undefined && input.contentType !== undefined,
            "Provide exactly one of {url} or {base64, contentType}",
          ),
      },
      async ({ url, base64, contentType }) => {
        const image =
          url !== undefined
            ? await downloadImage(url)
            : base64 !== undefined && contentType !== undefined
              ? decodeImage(base64, contentType)
              : undefined;
        if (!image) throw new Error("Provide {url} or {base64, contentType}");
        const { client, secret } = convex();
        const uploadUrl = await client.mutation(api.images.uploadUrl, {
          secret,
        });
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": image.type },
          body: image,
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("Image upload failed");
        const { storageId } = z
          .object({ storageId: z.string().min(1) })
          .parse(await response.json());
        // Convex validates the storage ID and its metadata before returning a preview.
        return result(
          await client.query(api.images.preview, {
            secret,
            imageId: storageId as Id<"_storage">,
          }),
        );
      },
    );
    server.registerTool(
      "image_upload_url",
      {
        description:
          "Get a one-time Convex upload URL and a curl example for a local JPEG/PNG file (1 byte–8 MB). POST the file to uploadUrl, then use the returned storageId as imageId in a create_draft/update_draft part. Verify with search_posts fullParts=true or list_queue. SVG is not accepted; export PNG.",
        inputSchema: z.strictObject({}),
      },
      async () => {
        const { client, secret } = convex();
        const uploadUrl = await client.mutation(api.images.uploadUrl, {
          secret,
        });
        return result({
          uploadUrl,
          curl: `curl -X POST -H 'Content-Type: image/png' --data-binary @file.png '${uploadUrl.replaceAll("'", "'\\''")}'`,
          response: {
            storageId:
              "Use this value as imageId in a create_draft/update_draft part",
          },
        });
      },
    );
    server.registerTool(
      "list_queue",
      {
        description:
          "List posts with status, held reason, pinned state, account refresh errors, ISO/WIB times, and image previews",
        inputSchema: z.object({ days: z.number().positive().optional() }),
      },
      async ({ days }) => {
        const { client, secret } = convex();
        return result(
          await client.query(api.posts.listQueue, {
            secret,
            ...(days === undefined ? {} : { days }),
          }),
        );
      },
    );
    server.registerTool(
      "create_draft",
      {
        description:
          "Create a Threads draft. For images, call upload_image or image_upload_url first, then put the imageId in a part. JPEG/PNG only, max 8 MB; SVG must be exported as PNG",
        inputSchema: z.object({ parts, meta }),
      },
      async ({ parts, meta }) => {
        const { client, secret } = convex();
        return result({
          id: await client.mutation(api.posts.createDraft, {
            secret,
            parts,
            ...(meta === undefined ? {} : { meta }),
            source: "agent",
          }),
        });
      },
    );
    server.registerTool(
      "update_draft",
      {
        description:
          "Edit a draft or the unpublished parts of a failed post. For images, call upload_image or image_upload_url first, then put the imageId in a part. JPEG/PNG only, max 8 MB; SVG must be exported as PNG",
        inputSchema: z.object({ id, parts: parts.optional(), meta }),
      },
      async ({ id, parts, meta }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.posts.updateDraft, {
            secret,
            id,
            ...(parts === undefined ? {} : { parts }),
            ...(meta === undefined ? {} : { meta }),
            source: "agent",
          }),
        );
      },
    );
    server.registerTool(
      "queue",
      {
        description:
          "Queue at an exact ISO time (pinned) or the next free posting slot (unpinned)",
        inputSchema: z.object({
          id,
          at: z.iso.datetime({ offset: true }).optional(),
        }),
      },
      async ({ id, at }) => {
        const { client, secret } = convex();
        return result({
          at: await client.mutation(api.posts.queue, {
            secret,
            id,
            ...(at === undefined ? {} : { at: Date.parse(at) }),
            source: "agent",
          }),
        });
      },
    );
    server.registerTool(
      "reschedule",
      {
        description:
          "Move a queued post to an exact future ISO time (pinned); omit at for the next free slot (unpinned)",
        inputSchema: z.object({
          id,
          at: z.iso.datetime({ offset: true }).optional(),
        }),
      },
      async ({ id, at }) => {
        const { client, secret } = convex();
        return result({
          at: await client.mutation(api.posts.move, {
            secret,
            id,
            source: "agent",
            ...(at === undefined ? {} : { at: Date.parse(at) }),
          }),
        });
      },
    );
    server.registerTool(
      "swap",
      {
        description:
          "Exchange two queued posts' future times and pinned states",
        inputSchema: z.object({ id, otherId: id }),
      },
      async ({ id, otherId }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.posts.swap, {
            secret,
            id,
            otherId,
            source: "agent",
          }),
        );
      },
    );
    server.registerTool(
      "get_settings",
      {
        description:
          "Read posting windows, interval, time zone, and gap policy",
        inputSchema: z.object({}),
      },
      async () => {
        const { client, secret } = convex();
        return result(await client.query(api.posts.getSettings, { secret }));
      },
    );
    server.registerTool(
      "update_settings",
      {
        description:
          "Replace posting settings; windows include both endpoints. Existing queued times stay fixed",
        inputSchema: z.object({
          windows: z
            .array(z.object({ start: z.string(), end: z.string() }))
            .min(1),
          intervalMinutes: z.number().int().min(5).max(240),
          timeZone: z.literal("Asia/Jakarta"),
          gapPolicy: z.enum(["autoFill", "keepTimes"]),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.posts.updateSettings, { secret, ...args }),
        );
      },
    );
    server.registerTool(
      "unqueue",
      {
        description: "Return a queued post to drafts",
        inputSchema: z.object({ id }),
      },
      async ({ id }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.posts.unqueue, {
            secret,
            id,
            source: "agent",
          }),
        );
      },
    );
    server.registerTool(
      "publish_now",
      {
        description: "Publish now, resuming any parts already live",
        inputSchema: z.object({ id }),
      },
      async ({ id }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.posts.publishNow, {
            secret,
            id,
            source: "agent",
          }),
        );
      },
    );
    server.registerTool(
      "delete_post",
      {
        description:
          "Delete a post from antre; live Threads posts remain on Threads",
        inputSchema: z.object({ id }),
      },
      async ({ id }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.posts.deletePost, {
            secret,
            id,
            source: "agent",
          }),
        );
      },
    );
    server.registerTool(
      "taxonomy",
      {
        description:
          "List topic, angle, and format codes and names for tagging posts",
        inputSchema: z.object({}),
      },
      async () => {
        const { client, secret } = convex();
        return result(await client.query(api.library.taxonomy, { secret }));
      },
    );
    server.registerTool(
      "set_taxonomy",
      {
        description:
          "Upsert taxonomy entries by dimension and code; codes are user-defined data",
        inputSchema: z.object({
          entries: z.array(
            z.object({
              dimension,
              code: z.string().min(1),
              name: z.string().min(1),
              description: z.string().optional(),
            }),
          ),
        }),
      },
      async ({ entries }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.library.setTaxonomy, { secret, entries }),
        );
      },
    );
    server.registerTool(
      "tag_posts",
      {
        description:
          "Set meta on posts in any status. Topic/angle/format are codes from taxonomy. Omitted fields stay unchanged",
        inputSchema: z.object({
          posts: z.array(z.object({ id, meta: meta.unwrap() })),
        }),
      },
      async ({ posts }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.library.tagPosts, { secret, posts }),
        );
      },
    );
    server.registerTool(
      "search_posts",
      {
        description:
          "Search library; tags are codes from taxonomy. fullParts=true includes imageUrl on image parts to verify attachments. Dates/times without offsets use Asia/Jakarta (WIB); until dates include the whole day, until times are exclusive. Sort descending. Engagement = (likes + replies + reposts + quotes) / views; null without positive views",
        inputSchema: z.object({
          ...dateRange,
          status: z
            .enum([
              "draft",
              "queued",
              "publishing",
              "published",
              "failed",
              "held",
            ])
            .optional(),
          topic: z.string().optional(),
          angle: z.string().optional(),
          format: z.string().optional(),
          text: z.string().optional(),
          minViews: z.number().nonnegative().optional(),
          sort: z.enum(["date", "views", "engagement"]).optional(),
          limit: z.number().int().positive().optional(),
          fullParts: z.boolean().optional(),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result(
          await client.query(api.library.searchPosts, { secret, ...args }),
        );
      },
    );
    server.registerTool(
      "insights",
      {
        description:
          "Group published posts by taxonomy codes (untagged = null). Mean engagement = mean of (likes + replies + reposts + quotes) / views; best post uses engagement. minViews defaults to 1; zero views excluded. WIB date ranges match search_posts. Followers use latest snapshots at/before start and before end",
        inputSchema: z.object({
          ...dateRange,
          dimensions: z.array(dimension).min(1),
          minViews: z.number().nonnegative().optional(),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result(
          await client.query(api.library.insights, { secret, ...args }),
        );
      },
    );
    server.registerTool(
      "list_replies",
      {
        description:
          "List replies newest first with draft (null if none), parent and root post text. Set drafted=true to list pending drafts. unanswered defaults to true: excludes yours, hidden replies, and replies you answered. offset defaults to 0; limit defaults to 50; total counts matches before paging. syncedAt is the last complete reply sync (ISO or null); call sync_now if stale. Sync covers posts from the last 7 days",
        inputSchema: z.object({
          unanswered: z.boolean().optional(),
          drafted: z.boolean().optional(),
          postId: id.optional(),
          offset: z.number().int().nonnegative().optional(),
          limit: z.number().int().positive().optional(),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result(
          await client.query(api.replies.list, { secret, ...args }),
        );
      },
    );
    server.registerTool(
      "draft_reply",
      {
        description:
          "Save a draft answer to a stored replyId for human review; never publishes",
        inputSchema: z.object({
          replyId: z.string().min(1),
          text: z
            .string()
            .refine(
              (text) => text.trim().length > 0 && [...text].length <= 500,
              "Use 1–500 characters",
            ),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.replies.saveDraft, { secret, ...args }),
        );
      },
    );
    server.registerTool(
      "send_reply",
      {
        description:
          "Publishes the stored draft verbatim. Call ONLY after the human has seen that exact draft text in this conversation and explicitly told you to send it. Never call on your own initiative. If the draft changes, it must be shown again. Returns the new replyId and permalink if available",
        inputSchema: z.object({
          replyId: z.string().min(1),
          text: z
            .string()
            .describe(
              "the exact draft text the human saw and approved; must match the stored draft",
            ),
        }),
        annotations: { destructiveHint: true, openWorldHint: true },
      },
      async ({ replyId, text }) => {
        const { client, secret } = convex();
        return result(
          await client.action(api.replies.sendDraft, { secret, replyId, text }),
        );
      },
    );
    server.registerTool(
      "discard_reply_draft",
      {
        description: "Discard a stored reply draft without publishing",
        inputSchema: z.object({ replyId: z.string().min(1) }),
      },
      async ({ replyId }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.replies.discardDraft, { secret, replyId }),
        );
      },
    );
    server.registerTool(
      "hide_reply",
      {
        description:
          "Hide (hide=true) or unhide (hide=false) a stored reply on Threads and update its local visibility",
        inputSchema: z.object({
          replyId: z.string().min(1),
          hide: z.boolean(),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result(
          await client.action(api.replies.hide, { secret, ...args }),
        );
      },
    );
    server.registerTool(
      "sync_now",
      {
        description:
          "Import top-level Threads posts, remove published posts missing from a complete sync if older than 5 minutes, refresh recent/missing metrics, snapshot followers, and sync replies on posts from the last 7 days. Returns imported, removed, metricsUpdated, replies (rows synced), and any import, insights, or reply sync error",
        inputSchema: z.object({}),
      },
      async () => {
        const { client, secret } = convex();
        return result(await client.action(api.sync.now, { secret }));
      },
    );
  },
  { serverInfo: { name: "antre", version: "1.0.0" } },
);

const handle: RequestHandler = ({ request }) => {
  const expected = env.MCP_TOKEN;
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (
    !expected ||
    Buffer.byteLength(token) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  )
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  return handler(request);
};

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
