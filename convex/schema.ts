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
  timeZone: v.string(),
  gapPolicy,
};

export const owned = { workspaceId: v.optional(v.id("workspaces")) };

export default defineSchema({
  providerReceipts: defineTable({
    hash: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
    status: v.union(v.literal("pending"), v.literal("complete")),
    expiresAt: v.number(),
  })
    .index("by_hash", ["hash"])
    .index("by_workspace", ["workspaceId"])
    .index("by_expiry", ["expiresAt"]),
  users: defineTable({
    subject: v.string(),
    tokenIdentifier: v.optional(v.string()),
  }).index("by_subject", ["subject"]),
  workspaces: defineTable({
    ownerId: v.optional(v.id("users")),
    state: v.union(v.literal("active"), v.literal("deleting")),
    timeZone: v.string(),
    legacy: v.optional(v.literal(true)),
  })
    .index("by_owner", ["ownerId"])
    .index("by_legacy", ["legacy"]),
  agentGrants: defineTable({
    workspaceId: v.id("workspaces"),
    hash: v.string(),
    label: v.string(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_hash", ["hash"]),
  workspaceMigrations: defineTable({
    workspaceId: v.id("workspaces"),
    phase: v.union(v.literal("posts"), v.literal("done")),
    cursor: v.union(v.string(), v.null()),
  }).index("by_workspace", ["workspaceId"]),
  assetUploads: defineTable({
    workspaceId: v.id("workspaces"),
    hash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_hash", ["hash"]),
  assets: defineTable({
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_storageId", ["storageId"]),
  linkedinAccount: defineTable({
    ...owned,
    memberId: v.string(),
    name: v.string(),
    accessToken: v.string(),
    tokenExpiresAt: v.number(),
    needsReconnect: v.boolean(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_member", ["memberId"]),
  linkedinSettings: defineTable({
    ...owned,
    ...queueSettings,
    topics: v.array(v.string()),
    writingInstructions: v.string(),
  }).index("by_workspace", ["workspaceId"]),
  linkedinPosts: defineTable({
    ...owned,
    text: v.string(),
    topic: v.optional(v.string()),
    notes: v.optional(v.string()),
    source: v.union(v.literal("web"), v.literal("agent")),
    pinned: v.optional(v.boolean()),
    generation: v.optional(v.number()),
    lastStartedAt: v.optional(v.number()),
    status: v.union(
      v.object({ kind: v.literal("draft") }),
      v.object({
        kind: v.literal("queued"),
        at: v.number(),
        jobId: v.id("_scheduled_functions"),
        generation: v.number(),
      }),
      v.object({
        kind: v.literal("publishing"),
        at: v.number(),
        startedAt: v.number(),
        dispatchedAt: v.optional(v.number()),
      }),
      v.object({
        kind: v.literal("published"),
        at: v.number(),
        urn: v.string(),
        permalink: v.string(),
      }),
      v.object({
        kind: v.literal("held"),
        at: v.number(),
        heldAt: v.number(),
        reason: v.literal("auth"),
        error: v.string(),
      }),
      v.object({
        kind: v.literal("held"),
        at: v.number(),
        heldAt: v.number(),
        reason: v.literal("unknown"),
        startedAt: v.number(),
        error: v.string(),
      }),
      v.object({
        kind: v.literal("failed"),
        at: v.number(),
        error: v.string(),
      }),
    ),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_kind_at", ["status.kind", "status.at"])
    .index("workspace_by_kind_at", ["workspaceId", "status.kind", "status.at"]),
  replies: defineTable({
    ...owned,
    ...replyFields,
    draft: v.optional(v.string()),
    sending: v.optional(v.string()),
    sendingAt: v.optional(v.number()),
    lastSendingAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_threadsId", ["threadsId"])
    .index("workspace_by_threadsId", ["workspaceId", "threadsId"])
    .index("by_postId", ["postId"])
    .index("workspace_by_postId", ["workspaceId", "postId"]),
  taxonomy: defineTable({
    ...owned,
    dimension,
    code: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_dimension_code", ["dimension", "code"])
    .index("workspace_by_dimension_code", ["workspaceId", "dimension", "code"]),
  followers: defineTable({ ...owned, at: v.number(), count: v.number() }).index(
    "by_workspace",
    ["workspaceId"],
  ),
  posts: defineTable({
    ...owned,
    libraryIndexed: v.optional(v.literal(true)),
    rootPublishedId: v.optional(v.string()),
    parts: v.array(part),
    topicTag: v.optional(v.string()),
    publishedIds: v.array(v.string()),
    pinned: v.optional(v.boolean()),
    scheduleGeneration: v.optional(v.number()),
    lastStartedAt: v.optional(v.number()),
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
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_kind_metrics", ["status.kind", "metrics.syncedAt"])
    .index("workspace_by_kind_metrics", [
      "workspaceId",
      "status.kind",
      "metrics.syncedAt",
    ])
    .index("by_kind_at", ["status.kind", "status.at"])
    .index("workspace_by_kind_at", ["workspaceId", "status.kind", "status.at"])
    .index("by_at", ["status.at"])
    .index("workspace_by_at", ["workspaceId", "status.at"])
    .index("by_libraryIndexed", ["libraryIndexed"])
    .index("workspace_by_libraryIndexed", ["workspaceId", "libraryIndexed"])
    .index("by_rootPublishedId", ["rootPublishedId"])
    .index("workspace_by_rootPublishedId", ["workspaceId", "rootPublishedId"]),
  postStats: defineTable({
    ...owned,
    counts: v.object({
      drafts: v.number(),
      scheduled: v.number(),
      published: v.number(),
      failed: v.number(),
    }),
    publishedFacets: v.array(
      v.object({ dimension, code: v.string(), count: v.number() }),
    ),
  }).index("by_workspace", ["workspaceId"]),
  // Deployment bridge: migrateSettings replaces legacy rows; remove the legacy
  // branch in the next deployment after running that migration in production.
  settings: defineTable(
    v.union(
      v.object({ ...owned, ...queueSettings }),
      v.object({
        ...owned,
        timeZone: v.string(),
        windowStart: v.string(),
        windowEnd: v.string(),
        intervalMinutes: v.number(),
      }),
    ),
  ).index("by_workspace", ["workspaceId"]),
  account: defineTable({
    ...owned,
    threadsUserId: v.string(),
    username: v.string(),
    accessToken: v.string(),
    tokenExpiresAt: v.number(),
    needsReconnect: v.boolean(),
    lastRefreshError: v.optional(v.string()),
    lastRefreshErrorAt: v.optional(v.number()),
    repliesSyncedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_remote", ["threadsUserId"]),
});
