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
  })
  .optional();

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
