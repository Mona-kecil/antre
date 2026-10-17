import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const part = v.object({
  text: v.string(),
  imageId: v.optional(v.id("_storage")),
});
export const meta = v.object({
  topic: v.optional(v.string()),
  angle: v.optional(v.string()),
  format: v.optional(v.string()),
});

export default defineSchema({
  posts: defineTable({
    parts: v.array(part),
    publishedIds: v.array(v.string()),
    status: v.union(
      v.object({ kind: v.literal("draft") }),
      v.object({
        kind: v.literal("queued"),
        at: v.number(),
        jobId: v.id("_scheduled_functions"),
      }),
      v.object({
        kind: v.literal("publishing"),
        at: v.number(),
        startedAt: v.number(),
      }),
      v.object({
        kind: v.literal("published"),
        at: v.number(),
        permalink: v.string(),
      }),
      v.object({
        kind: v.literal("failed"),
        at: v.number(),
        error: v.string(),
      }),
    ),
    meta: v.optional(meta),
    source: v.union(v.literal("web"), v.literal("agent")),
  }),
  settings: defineTable({
    timeZone: v.string(),
    windowStart: v.string(),
    windowEnd: v.string(),
    intervalMinutes: v.number(),
  }),
  account: defineTable({
    threadsUserId: v.string(),
    username: v.string(),
    accessToken: v.string(),
    tokenExpiresAt: v.number(),
    needsReconnect: v.boolean(),
  }),
});
