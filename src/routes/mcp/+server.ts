import { timingSafeEqual } from "node:crypto";
import * as env from "$app/env/private";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convex } from "#lib/server/convex.ts";
import { dayStart, wib } from "#lib/time.ts";
import { topicTagSchema } from "#lib/topicTag.ts";
import { linkedinTextSchema } from "#lib/linkedin.ts";
import { IMAGE_TYPES } from "../../../convex/lib/media";
import { decodeImage, downloadImage, MAX_IMAGE_BASE64_LENGTH } from "./images";
import type { RequestHandler } from "./$types";

const id = z
  .string()
  .min(1)
  .transform((value) => value as Id<"posts">);
const linkedinId = z
  .string()
  .min(1)
  .transform((value) => value as Id<"linkedinPosts">);
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
        text: JSON.stringify(
          value === undefined ? { ok: true } : value,
          (key, item) =>
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
        annotations: { destructiveHint: false, openWorldHint: true },
        description:
          "Upload a JPEG or PNG image (1 byte–8 MB) from exactly one public HTTP(S) url or raw base64 + contentType. URL downloads time out after 10 seconds. Vercel caps request bodies near 4.5 MB, so for base64 images over about 3 MB use image_upload_url instead. Returns imageId and previewUrl; use imageId in a create_draft/update_draft part, then verify with search_posts fullParts=true or get_posts. SVG is not accepted; export PNG.",
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
        annotations: { destructiveHint: false, openWorldHint: false },
        description:
          "Get a one-time Convex upload URL and a curl example for a local JPEG/PNG file (1 byte–8 MB). POST the file to uploadUrl, then use the returned storageId as imageId in a create_draft/update_draft part. Verify with search_posts fullParts=true or get_posts. SVG is not accepted; export PNG.",
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
      "schedule",
      {
        annotations: { readOnlyHint: true, openWorldHint: false },
        description:
          "Read the Schedule tab for 1–14 WIB days (default: today, one day). Returns settings, account state without tokens, held count and nextSlot once, plus days with full posts and image previews. freeSlots and nextSlot are epoch milliseconds; freeSlots exclude past times and slots occupied by queued, publishing or published posts. Held posts await account reconnect and do not occupy slots. After reconnect, keepTimes advances their WIB clock time by whole days (using a later free slot to avoid collisions or preserve order); autoFill requeues held posts then later unpinned posts into free slots.",
        inputSchema: z.object({
          day: z.iso.date().optional(),
          days: z.number().int().min(1).max(14).optional(),
        }),
      },
      async ({ day, days }) => {
        const { client, secret } = convex();
        const from =
          day === undefined
            ? dayStart(Date.now())
            : Date.parse(`${day}T00:00:00+07:00`);
        const {
          settings,
          account,
          held,
          nextSlot,
          days: plan,
        } = await client.query(api.posts.schedule, {
          secret,
          from,
          days: days ?? 1,
        });
        return result({ settings, account, held, nextSlot, days: plan });
      },
    );
    server.registerTool(
      "list_posts",
      {
        annotations: { readOnlyHint: true, openWorldHint: false },
        description:
          "Read a Drafts/Library board with view counts, total, facets and a page of full posts with image previews. Scheduled includes queued, publishing and held posts. offset defaults to 0; limit must be 1–100 (default 25). Views/engagement sorts require the published view. Uses the board's validation and filtering rules.",
        inputSchema: z.object({
          view: z.enum(["drafts", "scheduled", "published", "failed"]),
          topic: z.string().optional(),
          angle: z.string().optional(),
          format: z.string().optional(),
          text: z.string().optional(),
          sort: z.enum(["date", "views", "engagement"]).optional(),
          offset: z.number().optional(),
          limit: z.number().optional(),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result(
          await client.query(api.library.page, { secret, ...args }),
        );
      },
    );
    server.registerTool(
      "get_posts",
      {
        annotations: { readOnlyHint: true, openWorldHint: false },
        description:
          "Fetch 1–50 full posts with status, at, pinned, held, parts with image previews, meta, metrics and published permalink, in input order; unknown ids return null. Use schedule for account state, held posts and the day's plan.",
        inputSchema: z.object({ ids: z.array(id).min(1).max(50) }),
      },
      async ({ ids }) => {
        const { client, secret } = convex();
        const { posts } = await client.query(api.posts.getPosts, {
          secret,
          ids,
        });
        return result(posts);
      },
    );
    server.registerTool(
      "create_draft",
      {
        annotations: { destructiveHint: false, openWorldHint: false },
        description:
          "Create a Threads draft. For images, call upload_image or image_upload_url first, then put the imageId in a part. JPEG/PNG only, max 8 MB; SVG must be exported as PNG",
        inputSchema: z.object({
          parts,
          meta,
          topicTag: topicTagSchema
            .optional()
            .describe(
              'Public Threads topic for the first post. Defaults to Marketing; pass "" for no tag. Separate from meta.topic, which is an internal label.',
            ),
        }),
      },
      async ({ parts, meta, topicTag }) => {
        const { client, secret } = convex();
        return result({
          id: await client.mutation(api.posts.createDraft, {
            secret,
            parts,
            ...(topicTag === undefined ? {} : { topicTag }),
            ...(meta === undefined ? {} : { meta }),
            source: "agent",
          }),
        });
      },
    );
    server.registerTool(
      "update_draft",
      {
        annotations: { destructiveHint: false, openWorldHint: false },
        description:
          "Edit a draft or the unpublished parts of a failed post. For images, call upload_image or image_upload_url first, then put the imageId in a part. JPEG/PNG only, max 8 MB; SVG must be exported as PNG",
        inputSchema: z.object({
          id,
          parts: parts.optional(),
          meta,
          topicTag: topicTagSchema
            .optional()
            .describe(
              'Public Threads topic for the first post. Omit to keep it, or pass "" to remove it. Cannot change after the first post is published. Separate from the internal meta.topic label.',
            ),
        }),
      },
      async ({ id, parts, meta, topicTag }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.posts.updateDraft, {
            secret,
            id,
            ...(parts === undefined ? {} : { parts }),
            ...(topicTag === undefined ? {} : { topicTag }),
            ...(meta === undefined ? {} : { meta }),
            source: "agent",
          }),
        );
      },
    );
    server.registerTool(
      "set_topic_tag",
      {
        annotations: {
          destructiveHint: false,
          openWorldHint: false,
          idempotentHint: true,
        },
        description:
          'Set the public Threads topic on 1–100 drafts, queued, held, or failed posts as one batch. Use topicTag="Marketing" or another topic; use "" to remove it. Rejects the whole batch if any post is publishing or has a published first part. Does not change the internal meta.topic label or the schedule.',
        inputSchema: z.object({
          ids: z.array(id).min(1).max(100),
          topicTag: topicTagSchema,
        }),
      },
      async ({ ids, topicTag }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.posts.setTopicTag, {
            secret,
            ids,
            topicTag,
          }),
        );
      },
    );
    server.registerTool(
      "queue",
      {
        annotations: { destructiveHint: false, openWorldHint: false },
        description:
          "Queue a draft or failed post at an exact ISO time (pinned) or the next free posting slot (unpinned). If the account needs reconnecting when its time comes, the post becomes held (see schedule)",
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
        annotations: { destructiveHint: false, openWorldHint: false },
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
        annotations: { destructiveHint: false, openWorldHint: false },
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
        annotations: { readOnlyHint: true, openWorldHint: false },
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
        annotations: { destructiveHint: true, openWorldHint: false },
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
        annotations: { destructiveHint: false, openWorldHint: false },
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
        annotations: { destructiveHint: true, openWorldHint: true },
        description:
          "Publish now or retry a failed post, running the recovery check and resuming any parts already live",
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
        annotations: { destructiveHint: true, openWorldHint: false },
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
        annotations: { readOnlyHint: true, openWorldHint: false },
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
        annotations: { destructiveHint: false, openWorldHint: false },
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
        annotations: { destructiveHint: false, openWorldHint: false },
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
        annotations: { readOnlyHint: true, openWorldHint: false },
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
        annotations: { readOnlyHint: true, openWorldHint: false },
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
        annotations: { readOnlyHint: true, openWorldHint: false },
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
        annotations: { destructiveHint: false, openWorldHint: false },
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
        annotations: { destructiveHint: true, openWorldHint: false },
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
        annotations: { destructiveHint: true, openWorldHint: true },
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
        annotations: { destructiveHint: true, openWorldHint: true },
        description:
          "Import top-level Threads posts, remove published posts missing from a complete sync if older than 5 minutes, refresh recent/missing metrics, snapshot followers, and sync replies on posts from the last 7 days. Returns imported, removed, metricsUpdated, replies (rows synced), and any import, insights, or reply sync error",
        inputSchema: z.object({}),
      },
      async () => {
        const { client, secret } = convex();
        return result(await client.action(api.sync.now, { secret }));
      },
    );
    server.registerTool(
      "list_linkedin_posts",
      {
        annotations: { readOnlyHint: true, openWorldHint: false },
        description:
          "Read the separate LinkedIn personal-profile text board. Returns full posts, total, view counts, account state without tokens, posting settings and nextSlot. Scheduled includes queued, publishing and held posts. Unknown-held posts include a numeric retryAttempt for attempt-bound retry consent. offset defaults to 0; limit defaults to 25 and must be 1–100. LinkedIn content and internal topic labels are separate from Threads.",
        inputSchema: z.strictObject({
          view: z.enum(["drafts", "scheduled", "published", "failed"]),
          offset: z.number().int().nonnegative().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result(
          await client.query(api.linkedin.list, { secret, ...args }),
        );
      },
    );
    server.registerTool(
      "get_linkedin_post",
      {
        annotations: { readOnlyHint: true, openWorldHint: false },
        description:
          "Read one LinkedIn personal-profile text post with its status, internal topic and notes, and published permalink when available. Unknown-held posts include a numeric retryAttempt; use that unchanged as expectedStartedAt only after the owner approves retrying that attempt. Unknown ids return null. Use list_linkedin_posts for LinkedIn account and queue state.",
        inputSchema: z.strictObject({ id: linkedinId }),
      },
      async ({ id }) => {
        const { client, secret } = convex();
        return result(await client.query(api.linkedin.get, { secret, id }));
      },
    );
    server.registerTool(
      "create_linkedin_draft",
      {
        annotations: { destructiveHint: false, openWorldHint: false },
        description:
          "Create a separate LinkedIn personal-profile text-only draft of 1–3000 characters. No images, videos or Threads parts. topic and notes are internal LinkedIn labels, not public tags or Threads taxonomy. Creating a draft does not publish it.",
        inputSchema: z.strictObject({
          text: linkedinTextSchema,
          topic: z.string().optional(),
          notes: z.string().optional(),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result({
          id: await client.mutation(api.linkedin.createDraft, {
            secret,
            ...args,
            source: "agent",
          }),
        });
      },
    );
    server.registerTool(
      "update_linkedin_draft",
      {
        annotations: { destructiveHint: false, openWorldHint: false },
        description:
          "Replace a LinkedIn draft's text, internal topic and notes. Text is required and must use 1–3000 characters; omitted topic or notes clears that field. Personal-profile text only; no media or Threads parts. Unqueue scheduled posts before editing.",
        inputSchema: z.strictObject({
          id: linkedinId,
          text: linkedinTextSchema,
          topic: z.string().optional(),
          notes: z.string().optional(),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.linkedin.updateDraft, { secret, ...args }),
        );
      },
    );
    server.registerTool(
      "queue_linkedin_post",
      {
        annotations: { destructiveHint: true, openWorldHint: true },
        description:
          "Schedule a LinkedIn personal-profile text post for public publication at an exact future ISO time, or omit at for the next free LinkedIn slot. This authorizes a public post. Use only after the user approves publishing this content. LinkedIn uses its own queue and posting settings.",
        inputSchema: z.strictObject({
          id: linkedinId,
          at: z.iso.datetime({ offset: true }).optional(),
        }),
      },
      async ({ id, at }) => {
        const { client, secret } = convex();
        return result({
          at: await client.mutation(api.linkedin.queue, {
            secret,
            id,
            ...(at === undefined ? {} : { at: Date.parse(at) }),
          }),
        });
      },
    );
    server.registerTool(
      "unqueue_linkedin_post",
      {
        annotations: { destructiveHint: false, openWorldHint: false },
        description:
          "Return a queued or auth-held LinkedIn post to drafts before it begins publishing. Does not remove a public LinkedIn post or clear an unknown publish outcome.",
        inputSchema: z.strictObject({ id: linkedinId }),
      },
      async ({ id }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.linkedin.unqueue, { secret, id }),
        );
      },
    );
    server.registerTool(
      "delete_linkedin_post",
      {
        annotations: { destructiveHint: true, openWorldHint: false },
        description:
          "Delete a LinkedIn post from antre unless it is publishing. Published posts remain on LinkedIn. Deleting a held post with an unknown outcome does not establish whether LinkedIn already published it.",
        inputSchema: z.strictObject({ id: linkedinId }),
      },
      async ({ id }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.linkedin.deletePost, { secret, id }),
        );
      },
    );
    server.registerTool(
      "publish_linkedin_post",
      {
        annotations: { destructiveHint: true, openWorldHint: true },
        description:
          "Publish a LinkedIn personal-profile text post publicly now. Use only after the user approves publishing this content. For failed or unknown-outcome posts use retry_linkedin_post; an unknown outcome may already have created a public post.",
        inputSchema: z.strictObject({ id: linkedinId }),
      },
      async ({ id }) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.linkedin.publishNow, { secret, id }),
        );
      },
    );
    server.registerTool(
      "retry_linkedin_post",
      {
        annotations: { destructiveHint: true, openWorldHint: true },
        description:
          "Retry public publication of a failed or held LinkedIn personal-profile text post. If status.reason is unknown, a public post may already exist: read the current retryAttempt with get_linkedin_post or list_linkedin_posts, ask the owner to check LinkedIn, and explain the duplicate risk. Only after their explicit acknowledgement for that attempt, set confirmDuplicateRisk=true and pass its retryAttempt unchanged as expectedStartedAt. A new unknown attempt requires fresh owner consent. Never infer that acknowledgement from an earlier publish request. Ordinary failed or auth-held retries need neither confirmation field.",
        inputSchema: z.strictObject({
          id: linkedinId,
          confirmDuplicateRisk: z
            .boolean()
            .optional()
            .describe(
              "Set true only after the user explicitly acknowledges that retrying an unknown outcome can create a duplicate public LinkedIn post.",
            ),
          expectedStartedAt: z
            .number()
            .optional()
            .describe(
              "The unchanged numeric retryAttempt from the current get_linkedin_post or list_linkedin_posts result that the owner reviewed and approved. Required with confirmDuplicateRisk=true for an unknown outcome; never reuse consent for a new attempt.",
            ),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.linkedin.retry, { secret, ...args }),
        );
      },
    );
    server.registerTool(
      "get_linkedin_settings",
      {
        annotations: { readOnlyHint: true, openWorldHint: false },
        description:
          "Read LinkedIn's separate posting windows, interval, time zone, gap policy, internal topics and writing instructions. Follow these channel-specific instructions when drafting. Use list_linkedin_posts for LinkedIn account state.",
        inputSchema: z.strictObject({}),
      },
      async () => {
        const { client, secret } = convex();
        return result(await client.query(api.linkedin.getSettings, { secret }));
      },
    );
    server.registerTool(
      "set_linkedin_settings",
      {
        annotations: { destructiveHint: true, openWorldHint: false },
        description:
          "Replace LinkedIn's separate posting settings; windows include both endpoints and existing queued times stay fixed. Optional topics and writingInstructions replace LinkedIn's internal topic list and drafting rules; omitted fields stay unchanged. Does not change Threads settings or taxonomy.",
        inputSchema: z.strictObject({
          windows: z
            .array(z.strictObject({ start: z.string(), end: z.string() }))
            .min(1),
          intervalMinutes: z.number().int().min(5).max(240),
          timeZone: z.literal("Asia/Jakarta"),
          gapPolicy: z.enum(["autoFill", "keepTimes"]),
          topics: z.array(z.string()).optional(),
          writingInstructions: z.string().optional(),
        }),
      },
      async (args) => {
        const { client, secret } = convex();
        return result(
          await client.mutation(api.linkedin.updateSettings, {
            secret,
            ...args,
          }),
        );
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
