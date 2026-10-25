import { v } from "convex/values";
import { z } from "zod";
import { isoDay } from "../src/lib/time";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type {
  OwnedActionCtx as ActionCtx,
  OwnedMutationCtx as MutationCtx,
  OwnedQueryCtx as QueryCtx,
} from "./access";
import { ownerAction } from "./auth";
import {
  creationOrder,
  insertPost,
  patchPost,
  postsByKind,
  deletePost as removePost,
} from "./lib/postStore";
import { readSettings } from "./lib/scheduling";
import { threads } from "./publishing";
import { metrics } from "./schema";
import { workspaceAction, workspaceMutation, workspaceQuery } from "./scoped";

const pageSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      text: z.string().optional(),
      timestamp: z
        .string()
        .refine((value) => Number.isFinite(Date.parse(value))),
      permalink: z.string(),
      media_type: z.string().optional(),
    }),
  ),
  paging: z
    .object({
      cursors: z.object({ after: z.string().optional() }).optional(),
      next: z.string().optional(),
    })
    .optional(),
});
const insightsSchema = z.object({
  data: z.array(
    z.object({
      name: z.string(),
      values: z
        .array(z.object({ value: z.number().finite().nonnegative().nullish() }))
        .optional(),
      total_value: z
        .object({ value: z.number().finite().nonnegative() })
        .optional(),
    }),
  ),
});

function values(body: unknown) {
  const result = insightsSchema.safeParse(body);
  if (!result.success) throw new Error("Threads returned invalid insights");
  return new Map(
    result.data.data.map((m) => [
      m.name,
      m.total_value?.value ?? m.values?.[0]?.value ?? 0,
    ]),
  );
}

export const importPage = workspaceMutation({
  args: {
    posts: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        at: v.number(),
        permalink: v.string(),
      }),
    ),
  },
  handler: async (ctx: MutationCtx, { posts }) => {
    const existing = await postsByKind(ctx, "publishing").collect();
    // Defer recent posts until publishing has recorded their Threads ids.
    const importBefore = existing.reduce(
      (before, post) =>
        post.status.kind === "publishing"
          ? Math.min(before, post.status.startedAt - 60_000)
          : before,
      Infinity,
    );
    let imported = 0;
    for (const post of posts) {
      if (post.at >= importBefore) continue;
      if (
        await ctx.db
          .query("posts")
          .withIndex("workspace_by_rootPublishedId", (q) =>
            q.eq("workspaceId", ctx.workspaceId).eq("rootPublishedId", post.id),
          )
          .first()
      )
        continue;
      await insertPost(ctx, {
        workspaceId: ctx.workspaceId,
        parts: [{ text: post.text }],
        publishedIds: [post.id],
        source: "threads",
        status: { kind: "published", at: post.at, permalink: post.permalink },
      });
      imported++;
    }
    return imported;
  },
});

export type RemovalPage = {
  page: { id: Id<"posts">; publishedId: string | null }[];
  isDone: boolean;
  continueCursor: string;
};

export const removalCandidates = workspaceQuery({
  args: { cutoff: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx: QueryCtx, { cutoff, cursor }): Promise<RemovalPage> => {
    const result = await postsByKind(
      ctx,
      "published",
      -Infinity,
      cutoff,
    ).paginate({
      cursor,
      numItems: 100,
      maximumBytesRead: 1_000_000,
    });
    return {
      ...result,
      page: result.page.map((post) => ({
        id: post._id,
        publishedId: post.publishedIds[0] ?? null,
      })),
    };
  },
});

export const removeMissing = workspaceMutation({
  args: {
    posts: v.array(
      v.object({
        id: v.id("posts"),
        publishedId: v.union(v.string(), v.null()),
      }),
    ),
    cutoff: v.number(),
  },
  handler: async (ctx: MutationCtx, { posts, cutoff }) => {
    let removed = 0;
    for (const candidate of posts) {
      const post = await ctx.db.get(candidate.id);
      if (
        !post ||
        post.workspaceId !== ctx.workspaceId ||
        post.status.kind !== "published" ||
        post.status.at >= cutoff ||
        (post.publishedIds[0] ?? null) !== candidate.publishedId
      )
        continue;
      const replies = await ctx.db
        .query("replies")
        .withIndex("workspace_by_postId", (q) =>
          q.eq("workspaceId", ctx.workspaceId).eq("postId", post._id),
        )
        .collect();
      for (const reply of replies) await ctx.db.delete(reply._id);
      await removePost(ctx, post._id);
      removed++;
    }
    return removed;
  },
});

export const metricTargets = workspaceQuery({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const recent = await postsByKind(
      ctx,
      "published",
      Date.now() - 30 * 86_400_000,
    ).collect();
    const missing = await ctx.db
      .query("posts")
      .withIndex("workspace_by_kind_metrics", (q) =>
        q
          .eq("workspaceId", ctx.workspaceId)
          .eq("status.kind", "published")
          .eq("metrics.syncedAt", undefined),
      )
      .collect();
    const posts = new Map(
      [...recent, ...missing].map((post) => [post._id, post]),
    );
    return [...posts.values()]
      .sort(creationOrder)
      .filter((post) => post.publishedIds[0]);
  },
});

export const saveMetrics = workspaceMutation({
  args: { id: v.id("posts"), metrics },
  handler: async (ctx: MutationCtx, { id, metrics }) => {
    const post = await ctx.db.get(id);
    if (!post || post.workspaceId !== ctx.workspaceId) return false;
    await patchPost(ctx, id, { metrics });
    return true;
  },
});

export const saveFollowers = workspaceMutation({
  args: { at: v.number(), count: v.number() },
  handler: async (ctx: MutationCtx, { at, count }) => {
    const timeZone = (await readSettings(ctx)).timeZone;
    const day = (time: number) => isoDay(time, timeZone);
    const existing = (
      await ctx.db
        .query("followers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
        .collect()
    ).find((row) => day(row.at) === day(at));
    if (existing) await ctx.db.patch(existing._id, { at, count });
    else
      await ctx.db.insert("followers", {
        workspaceId: ctx.workspaceId,
        at,
        count,
      });
  },
});

type SyncResult = {
  imported: number;
  removed: number;
  metricsUpdated: number;
  replies: number;
  error: string | null;
};
export const run = workspaceAction({
  args: {},
  handler: async (ctx: ActionCtx): Promise<SyncResult> => {
    const startedAt = Date.now();
    let imported = 0;
    let removed = 0;
    let metricsUpdated = 0;
    const errors = new Set<string>();
    const account = await ctx.runQuery(internal.publishing.getAccount, {
      workspaceId: ctx.workspaceId,
    });
    if (
      !account ||
      account.needsReconnect ||
      account.tokenExpiresAt <= Date.now()
    )
      return {
        imported,
        removed,
        metricsUpdated,
        replies: 0,
        error: "Threads account needs reconnecting",
      };
    const scopedThreads = async (...args: Parameters<typeof threads>) => {
      await ctx.runQuery(internal.access.background, {
        workspaceId: ctx.workspaceId,
        expectedToken: account.accessToken,
      });
      return threads(...args);
    };
    const recordError = (context: string, error: unknown) =>
      errors.add(
        `${context}: ${error instanceof Error ? error.message.replaceAll(account.accessToken, "[redacted]") : "Threads request failed"}`,
      );
    try {
      let after: string | undefined;
      const seen = new Set<string>();
      const seenIds = new Set<string>();
      do {
        const parsed = pageSchema.safeParse(
          await scopedThreads("me/threads", account.accessToken, {
            fields: "id,text,timestamp,permalink,media_type",
            limit: "100",
            ...(after ? { after } : {}),
          }),
        );
        if (!parsed.success)
          throw new Error("Threads returned invalid posts or pagination");
        const page = parsed.data;
        for (const post of page.data) seenIds.add(post.id);
        imported += await ctx.runMutation(internal.sync.importPage, {
          workspaceId: ctx.workspaceId,
          expectedToken: account.accessToken,
          posts: page.data.map((p) => ({
            id: p.id,
            text: p.text ?? "",
            at: Date.parse(p.timestamp),
            permalink: p.permalink,
          })),
        });
        after = page.paging?.next
          ? (page.paging.cursors?.after ??
            new URL(page.paging.next).searchParams.get("after") ??
            undefined)
          : undefined;
        if (page.paging?.next && !after)
          throw new Error("Threads pagination is missing an after cursor");
        if (after && seen.has(after))
          throw new Error("Threads repeated a pagination cursor");
        if (after) seen.add(after);
      } while (after);
      // Keep the remote seen set in the action, rather than sending a history-sized
      // array to one mutation. Local history is read and deleted in bounded pages.
      const cutoff = startedAt - 5 * 60_000;
      let cursor: string | null = null;
      while (true) {
        const candidates: RemovalPage = await ctx.runQuery(
          internal.sync.removalCandidates,
          {
            workspaceId: ctx.workspaceId,
            cutoff,
            cursor,
          },
        );
        const missing = candidates.page.filter(
          (post) => post.publishedId === null || !seenIds.has(post.publishedId),
        );
        if (missing.length)
          removed += await ctx.runMutation(internal.sync.removeMissing, {
            workspaceId: ctx.workspaceId,
            expectedToken: account.accessToken,
            posts: missing,
            cutoff,
          });
        if (candidates.isDone) break;
        cursor = candidates.continueCursor;
      }
    } catch (error) {
      recordError("Post import", error);
    }
    for (const post of await ctx.runQuery(internal.sync.metricTargets, {
      workspaceId: ctx.workspaceId,
    })) {
      try {
        const m = values(
          await scopedThreads(
            `${post.publishedIds[0]}/insights`,
            account.accessToken,
            { metric: "views,likes,replies,reposts,quotes,shares" },
          ),
        );
        if (
          await ctx.runMutation(internal.sync.saveMetrics, {
            workspaceId: ctx.workspaceId,
            expectedToken: account.accessToken,
            id: post._id,
            metrics: {
              views: m.get("views") ?? 0,
              likes: m.get("likes") ?? 0,
              replies: m.get("replies") ?? 0,
              reposts: m.get("reposts") ?? 0,
              quotes: m.get("quotes") ?? 0,
              shares: m.get("shares") ?? 0,
              syncedAt: Date.now(),
            },
          })
        )
          metricsUpdated++;
      } catch (error) {
        recordError("Post insights (requires threads_manage_insights)", error);
      }
    }
    try {
      const m = values(
        await scopedThreads(
          `${account.threadsUserId}/threads_insights`,
          account.accessToken,
          { metric: "followers_count" },
        ),
      );
      await ctx.runMutation(internal.sync.saveFollowers, {
        workspaceId: ctx.workspaceId,
        expectedToken: account.accessToken,
        at: Date.now(),
        count: m.get("followers_count") ?? 0,
      });
    } catch (error) {
      recordError(
        "Follower insights (requires threads_manage_insights)",
        error,
      );
    }
    const replySync = await ctx.runAction(internal.replies.sync, {
      workspaceId: ctx.workspaceId,
    });
    if (replySync.error) errors.add(replySync.error);
    return {
      imported,
      removed,
      metricsUpdated,
      replies: replySync.replies,
      error: errors.size ? [...errors].join("; ") : null,
    };
  },
});

export const now = ownerAction(
  {},
  async (ctx: ActionCtx): Promise<SyncResult> =>
    await ctx.runAction(internal.sync.run, { workspaceId: ctx.workspaceId }),
);
