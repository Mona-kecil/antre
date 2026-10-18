import { timingSafeEqual } from "node:crypto";
import * as env from "$app/env/private";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convex } from "#lib/server/convex.ts";
import { wib } from "#lib/time.ts";
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
          ["at", "startedAt", "_creationTime"].includes(key) &&
          typeof item === "number"
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
      "list_queue",
      {
        description: "List drafts and posts, with times in ISO and WIB",
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
        description: "Create a Threads draft",
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
        description: "Edit a draft or the unpublished parts of a failed post",
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
        description: "Queue at an ISO 8601 time or the next free WIB slot",
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
          "Search library; tags are codes from taxonomy. Dates/times without offsets use Asia/Jakarta (WIB); until dates include the whole day, until times are exclusive. Sort descending. Engagement = (likes + replies + reposts + quotes) / views; null without positive views",
        inputSchema: z.object({
          ...dateRange,
          status: z
            .enum(["draft", "queued", "publishing", "published", "failed"])
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
          "List replies newest first with draft (null if none), parent and root post text. Set drafted=true to list pending drafts. unanswered defaults to true: excludes yours, hidden replies, and replies you answered. limit defaults to 50. syncedAt is the last complete reply sync (ISO or null); call sync_now if stale. Sync covers posts from the last 7 days",
        inputSchema: z.object({
          unanswered: z.boolean().optional(),
          drafted: z.boolean().optional(),
          postId: id.optional(),
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
