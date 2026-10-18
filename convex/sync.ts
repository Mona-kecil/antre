import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { withSecret } from "./auth";
import { threads } from "./publishing";
import { metrics } from "./schema";

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

export const importPage = internalMutation({
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
  handler: async (ctx, { posts }) => {
    const existing = await ctx.db.query("posts").collect();
    const known = new Set(existing.map((post) => post.publishedIds[0]));
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
      if (known.has(post.id) || post.at >= importBefore) continue;
      await ctx.db.insert("posts", {
        parts: [{ text: post.text }],
        publishedIds: [post.id],
        source: "threads",
        status: { kind: "published", at: post.at, permalink: post.permalink },
      });
      known.add(post.id);
      imported++;
    }
    return imported;
  },
});

export const removeMissing = internalMutation({
  args: { seenIds: v.array(v.string()), cutoff: v.number() },
  handler: async (ctx, { seenIds, cutoff }) => {
    const seen = new Set(seenIds);
    let removed = 0;
    for (const post of await ctx.db.query("posts").collect()) {
      if (
        post.status.kind === "published" &&
        post.status.at < cutoff &&
        !seen.has(post.publishedIds[0])
      ) {
        await ctx.db.delete(post._id);
        removed++;
      }
    }
    return removed;
  },
});

export const metricTargets = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("posts").collect()).filter(
      (post) =>
        post.status.kind === "published" &&
        post.publishedIds[0] &&
        (!post.metrics || post.status.at >= Date.now() - 30 * 86_400_000),
    ),
});

export const saveMetrics = internalMutation({
  args: { id: v.id("posts"), metrics },
  handler: async (ctx, { id, metrics }) => {
    if (!(await ctx.db.get(id))) return false;
    await ctx.db.patch(id, { metrics });
    return true;
  },
});

export const saveFollowers = internalMutation({
  args: { at: v.number(), count: v.number() },
  handler: async (ctx, { at, count }) => {
    const day = (time: number) =>
      Math.floor((time + 7 * 3_600_000) / 86_400_000);
    const existing = (await ctx.db.query("followers").collect()).find(
      (row) => day(row.at) === day(at),
    );
    if (existing) await ctx.db.patch(existing._id, { at, count });
    else await ctx.db.insert("followers", { at, count });
  },
});

type SyncResult = {
  imported: number;
  removed: number;
  metricsUpdated: number;
  error: string | null;
};
export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<SyncResult> => {
    const startedAt = Date.now();
    let imported = 0;
    let removed = 0;
    let metricsUpdated = 0;
    const errors = new Set<string>();
    const account = await ctx.runQuery(internal.publishing.getAccount, {});
    if (
      !account ||
      account.needsReconnect ||
      account.tokenExpiresAt <= Date.now()
    )
      return {
        imported,
        removed,
        metricsUpdated,
        error: "Threads account needs reconnecting",
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
          await threads("me/threads", account.accessToken, {
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
      removed = await ctx.runMutation(internal.sync.removeMissing, {
        seenIds: [...seenIds],
        cutoff: startedAt - 5 * 60_000,
      });
    } catch (error) {
      recordError("Post import", error);
    }
    for (const post of await ctx.runQuery(internal.sync.metricTargets, {})) {
      try {
        const m = values(
          await threads(
            `${post.publishedIds[0]}/insights`,
            account.accessToken,
            { metric: "views,likes,replies,reposts,quotes,shares" },
          ),
        );
        if (
          await ctx.runMutation(internal.sync.saveMetrics, {
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
        await threads(
          `${account.threadsUserId}/threads_insights`,
          account.accessToken,
          { metric: "followers_count" },
        ),
      );
      await ctx.runMutation(internal.sync.saveFollowers, {
        at: Date.now(),
        count: m.get("followers_count") ?? 0,
      });
    } catch (error) {
      recordError(
        "Follower insights (requires threads_manage_insights)",
        error,
      );
    }
    return {
      imported,
      removed,
      metricsUpdated,
      error: errors.size ? [...errors].join("; ") : null,
    };
  },
});

export const now = action(
  withSecret(
    {},
    async (ctx: ActionCtx): Promise<SyncResult> =>
      await ctx.runAction(internal.sync.run, {}),
  ),
);
