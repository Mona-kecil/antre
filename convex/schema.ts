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
  hook: v.optional(v.string()),
  notes: v.optional(v.string()),
});

export const dimension = v.union(
  v.literal("topic"),
  v.literal("angle"),
  v.literal("format"),
);
export const metrics = v.object({
  views: v.number(),
  likes: v.number(),
  replies: v.number(),
  reposts: v.number(),
  quotes: v.number(),
  shares: v.number(),
  syncedAt: v.number(),
});

export const replyFields = {
  threadsId: v.string(),
  postId: v.id("posts"),
  text: v.string(),
  username: v.string(),
  at: v.number(),
  permalink: v.optional(v.string()),
  repliedToId: v.optional(v.string()),
  mine: v.boolean(),
  hidden: v.boolean(),
};

export const postingWindow = v.object({ start: v.string(), end: v.string() });
export const gapPolicy = v.union(v.literal("autoFill"), v.literal("keepTimes"));
export const queueSettings = {
  windows: v.array(postingWindow),
  intervalMinutes: v.number(),
  timeZone: v.literal("Asia/Jakarta"),
  gapPolicy,
};

export default defineSchema({
  replies: defineTable({
    ...replyFields,
    draft: v.optional(v.string()),
    sending: v.optional(v.string()),
    sendingAt: v.optional(v.number()),
  }).index("by_threadsId", ["threadsId"]),
  taxonomy: defineTable({
    dimension,
    code: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  }).index("by_dimension_code", ["dimension", "code"]),
  followers: defineTable({ at: v.number(), count: v.number() }),
  posts: defineTable({
    parts: v.array(part),
    publishedIds: v.array(v.string()),
    pinned: v.optional(v.boolean()),
    scheduleGeneration: v.optional(v.number()),
    status: v.union(
      v.object({ kind: v.literal("draft") }),
      v.object({
        kind: v.literal("queued"),
        at: v.number(),
        jobId: v.id("_scheduled_functions"),
        generation: v.optional(v.number()),
        retry: v.optional(v.boolean()),
      }),
      v.object({
        kind: v.literal("publishing"),
        at: v.number(),
        startedAt: v.number(),
        retry: v.optional(v.boolean()),
        attempt: v.optional(v.number()),
        retryAt: v.optional(v.number()),
        retryJobId: v.optional(v.id("_scheduled_functions")),
      }),
      v.object({
        kind: v.literal("published"),
        at: v.number(),
        permalink: v.string(),
      }),
      v.object({
        kind: v.literal("held"),
        at: v.number(),
        heldAt: v.number(),
        reason: v.string(),
        retry: v.optional(v.boolean()),
      }),
      v.object({
        kind: v.literal("failed"),
        at: v.number(),
        error: v.string(),
      }),
    ),
    meta: v.optional(meta),
    source: v.union(v.literal("web"), v.literal("agent"), v.literal("threads")),
    metrics: v.optional(metrics),
  }),
  // Deployment bridge: migrateSettings replaces legacy rows; remove the legacy
  // branch in the next deployment after running that migration in production.
  settings: defineTable(
    v.union(
      v.object(queueSettings),
      v.object({
        timeZone: v.string(),
        windowStart: v.string(),
        windowEnd: v.string(),
        intervalMinutes: v.number(),
      }),
    ),
  ),
  account: defineTable({
    threadsUserId: v.string(),
    username: v.string(),
    accessToken: v.string(),
    tokenExpiresAt: v.number(),
    needsReconnect: v.boolean(),
    lastRefreshError: v.optional(v.string()),
    lastRefreshErrorAt: v.optional(v.number()),
    repliesSyncedAt: v.optional(v.number()),
  }),
});
