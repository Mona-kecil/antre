import {
  audienceMetrics,
  creationOrder,
  dimensions,
  kinds,
  libraryStats,
  postsByKind,
  patchPost,
  unindexedPosts,
  viewOf,
  viewForKind,
} from "./lib/postStore";
import { v } from "convex/values";
import { z } from "zod";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { withSecret } from "./auth";
import { partsWithImages } from "./lib/media";
import { accountState } from "./lib/scheduling";
import { dimension, meta } from "./schema";

const range = { since: v.optional(v.string()), until: v.optional(v.string()) };
const dateInput = z.union([
  z.iso.date(),
  z.iso.datetime({ offset: true, local: true }),
]);

// Date-only bounds cover whole WIB days. An offset-free time also means WIB.
function boundary(value: string | undefined, end: boolean) {
  if (value === undefined) return end ? Infinity : -Infinity;
  if (!dateInput.safeParse(value).success)
    throw new Error("Use ISO dates or times (WIB if no offset)");
  const day = value.length === 10;
  const at = Date.parse(
    day
      ? `${value}T00:00:00+07:00`
      : /(?:Z|[+-]\d\d:\d\d)$/.test(value)
        ? value
        : `${value}+07:00`,
  );
  return at + (day && end ? 86_400_000 : 0);
}

function bounds(args: { since?: string; until?: string }) {
  const since = boundary(args.since, false);
  const until = boundary(args.until, true);
  if (since >= until) throw new Error("Since must precede until");
  return { since, until };
}

function date(post: Doc<"posts">) {
  return post.status.kind === "draft" ? post._creationTime : post.status.at;
}

function engagement(post: Doc<"posts">) {
  const m = audienceMetrics(post);
  return m && m.views > 0
    ? (m.likes + m.replies + m.reposts + m.quotes) / m.views
    : null;
}

export const taxonomy = query(
  withSecret({}, async (ctx: QueryCtx) =>
    (await ctx.db.query("taxonomy").collect()).sort(
      (a, b) =>
        a.dimension.localeCompare(b.dimension) || a.code.localeCompare(b.code),
    ),
  ),
);

export const setTaxonomy = mutation(
  withSecret(
    {
      entries: v.array(
        v.object({
          dimension,
          code: v.string(),
          name: v.string(),
          description: v.optional(v.string()),
        }),
      ),
    },
    async (ctx: MutationCtx, { entries }) => {
      for (const entry of entries) {
        if (!entry.code.trim() || !entry.name.trim())
          throw new Error("Taxonomy code and name are required");
        const existing = await ctx.db
          .query("taxonomy")
          .withIndex("by_dimension_code", (q) =>
            q.eq("dimension", entry.dimension).eq("code", entry.code),
          )
          .unique();
        if (existing) await ctx.db.patch(existing._id, entry);
        else await ctx.db.insert("taxonomy", entry);
      }
      return { updated: entries.length };
    },
  ),
);

export const tagPosts = mutation(
  withSecret(
    {
      posts: v.array(v.object({ id: v.id("posts"), meta })),
    },
    async (ctx: MutationCtx, { posts }) => {
      for (const { id, meta } of posts) {
        const post = await ctx.db.get(id);
        if (!post) throw new Error("Post not found");
        await patchPost(ctx, id, { meta: { ...post.meta, ...meta } });
      }
      return { updated: posts.length };
    },
  ),
);

export const searchPosts = query(
  withSecret(
    {
      ...range,
      status: v.optional(
        v.union(
          v.literal("draft"),
          v.literal("queued"),
          v.literal("publishing"),
          v.literal("published"),
          v.literal("failed"),
          v.literal("held"),
        ),
      ),
      topic: v.optional(v.string()),
      angle: v.optional(v.string()),
      format: v.optional(v.string()),
      text: v.optional(v.string()),
      minViews: v.optional(v.number()),
      sort: v.optional(
        v.union(v.literal("date"), v.literal("views"), v.literal("engagement")),
      ),
      limit: v.optional(v.number()),
      fullParts: v.optional(v.boolean()),
    },
    async (ctx: QueryCtx, args) => {
      const { since, until } = bounds(args);
      const limit = args.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error("Limit must be a positive integer");
      if (
        args.minViews !== undefined &&
        (!Number.isFinite(args.minViews) || args.minViews < 0)
      )
        throw new Error("MinViews must be nonnegative");
      const textQuery = args.text?.toLowerCase();
      const candidates = args.status
        ? await postsByKind(ctx, args.status, since, until).collect()
        : Number.isFinite(since) || Number.isFinite(until)
          ? (
              await Promise.all(
                kinds.map((kind) =>
                  postsByKind(ctx, kind, since, until).collect(),
                ),
              )
            ).flat()
          : await ctx.db.query("posts").collect();
      // Filtering/sorting used to start in creation order; retain stable score ties.
      candidates.sort(creationOrder);
      const posts = candidates.filter(
        (post) =>
          (!args.status || post.status.kind === args.status) &&
          date(post) >= since &&
          date(post) < until &&
          (!args.topic || post.meta?.topic === args.topic) &&
          (!args.angle || post.meta?.angle === args.angle) &&
          (!args.format || post.meta?.format === args.format) &&
          (textQuery === undefined ||
            post.parts.some(({ text }) =>
              text.toLowerCase().includes(textQuery),
            )) &&
          (args.minViews === undefined ||
            (post.metrics?.views ?? 0) >= args.minViews),
      );
      const score = (post: Doc<"posts">) =>
        args.sort === "views"
          ? (post.metrics?.views ?? -1)
          : args.sort === "engagement"
            ? (engagement(post) ?? -1)
            : date(post);
      return await Promise.all(
        posts
          .sort((a, b) => score(b) - score(a) || date(b) - date(a))
          .slice(0, limit)
          .map(async (post) => ({
            id: post._id,
            status: post.status.kind,
            date: new Date(date(post)).toISOString(),
            text: post.parts[0]?.text ?? "",
            topicTag: post.topicTag,
            ...(args.fullParts
              ? { parts: await partsWithImages(ctx, post.parts) }
              : {}),
            meta: post.meta ?? {},
            metrics: audienceMetrics(post),
            engagement: engagement(post),
            permalink:
              post.status.kind === "published" ? post.status.permalink : null,
          })),
      );
    },
  ),
);

export const page = query(
  withSecret(
    {
      view: v.union(
        v.literal("drafts"),
        v.literal("scheduled"),
        v.literal("published"),
        v.literal("failed"),
      ),
      topic: v.optional(v.string()),
      angle: v.optional(v.string()),
      format: v.optional(v.string()),
      text: v.optional(v.string()),
      sort: v.optional(
        v.union(v.literal("date"), v.literal("views"), v.literal("engagement")),
      ),
      offset: v.optional(v.number()),
      limit: v.optional(v.number()),
    },
    async (ctx: QueryCtx, args) => {
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 25;
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error("Offset must be a nonnegative integer");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new Error("Limit must be an integer between 1 and 100");
      if (args.view !== "published" && args.sort && args.sort !== "date")
        throw new Error(
          "Views and engagement sorting require the published view",
        );

      const stats = await libraryStats(ctx);
      const counts = stats.counts;
      // Only the default published page reads a bounded slice. Text search,
      // tag filters and views/engagement sorts read every post in the view to
      // keep totals and facet counts exact, so their cost grows with that view.
      const defaultPublished =
        args.view === "published" &&
        (args.sort === undefined || args.sort === "date") &&
        (args.text === undefined || args.text === "") &&
        dimensions.every((d) => args[d] === undefined);
      let posts: Doc<"posts">[];
      if (defaultPublished) {
        // Read complete date/creation-time tie groups so the final id tie-break
        // matches the in-memory comparator, including at the page boundary.
        const selected = await postsByKind(ctx, "published")
          .order("desc")
          .take(offset + limit);
        const last = selected.at(-1);
        if (last?.status.kind === "published") {
          const lastAt = last.status.at;
          const tied = await ctx.db
            .query("posts")
            .withIndex("by_kind_at", (q) =>
              q
                .eq("status.kind", "published")
                .eq("status.at", lastAt)
                .eq("_creationTime", last._creationTime),
            )
            .collect();
          const ids = new Set(selected.map((post) => post._id));
          selected.push(...tied.filter((post) => !ids.has(post._id)));
        }
        posts = selected;
      } else {
        const viewKinds = kinds.filter(
          (kind) => viewForKind(kind) === args.view,
        );
        posts = (
          await Promise.all(
            viewKinds.map((kind) => postsByKind(ctx, kind).collect()),
          )
        ).flat();
      }
      const text = args.text?.toLowerCase();
      const inView = posts.filter(
        (post) =>
          viewOf(post) === args.view &&
          (text === undefined ||
            [
              ...post.parts.map((part) => part.text),
              post.meta?.hook ?? "",
              post.meta?.notes ?? "",
            ].some((value) => value.toLowerCase().includes(text))),
      );
      const matches = (
        post: Doc<"posts">,
        ignore?: (typeof dimensions)[number],
      ) =>
        dimensions.every(
          (dimension) =>
            dimension === ignore ||
            args[dimension] === undefined ||
            post.meta?.[dimension] === args[dimension],
        );
      const facets: Record<
        (typeof dimensions)[number],
        Record<string, number>
      > = {
        topic: {},
        angle: {},
        format: {},
      };
      if (defaultPublished) {
        for (const dimension of dimensions) {
          facets[dimension] = Object.fromEntries(
            stats.publishedFacets
              .filter((f) => f.dimension === dimension)
              .sort((a, b) => a.code.localeCompare(b.code))
              .map((f) => [f.code, f.count]),
          );
        }
      } else {
        for (const dimension of dimensions) {
          const counts = new Map<string, number>();
          for (const post of inView) {
            const code = post.meta?.[dimension];
            if (code !== undefined && matches(post, dimension))
              counts.set(code, (counts.get(code) ?? 0) + 1);
          }
          facets[dimension] = Object.fromEntries(
            [...counts].sort(([a], [b]) => a.localeCompare(b)),
          );
        }
      }
      const filtered = inView.filter((post) => matches(post));
      const score = (post: Doc<"posts">) =>
        args.sort === "views"
          ? (post.metrics?.views ?? -1)
          : args.sort === "engagement"
            ? (engagement(post) ?? -1)
            : date(post);
      const direction = args.view === "scheduled" ? 1 : -1;
      filtered.sort(
        (a, b) =>
          direction * (score(a) - score(b)) ||
          direction * (date(a) - date(b)) ||
          b._creationTime - a._creationTime ||
          a._id.localeCompare(b._id),
      );
      const items = await Promise.all(
        filtered.slice(offset, offset + limit).map(async (post) => ({
          id: post._id,
          status: post.status,
          at: post.status.kind === "draft" ? null : post.status.at,
          pinned: post.pinned ?? post.status.kind === "queued",
          held: post.status.kind === "held",
          parts: await partsWithImages(ctx, post.parts),
          topicTag: post.topicTag,
          meta: post.meta ?? {},
          source: post.source,
          metrics: audienceMetrics(post),
          engagement: engagement(post),
          _creationTime: post._creationTime,
        })),
      );
      const account = accountState(await ctx.db.query("account").unique());
      return {
        items,
        total: defaultPublished ? counts.published : filtered.length,
        counts,
        facets,
        account,
      };
    },
  ),
);

export const insights = query(
  withSecret(
    {
      ...range,
      dimensions: v.array(dimension),
      minViews: v.optional(v.number()),
    },
    async (ctx: QueryCtx, args) => {
      const { since, until } = bounds(args);
      const minViews = args.minViews ?? 1;
      if (!Number.isFinite(minViews) || minViews < 0)
        throw new Error("MinViews must be nonnegative");
      if (
        !args.dimensions.length ||
        new Set(args.dimensions).size !== args.dimensions.length
      )
        throw new Error("Choose one or more distinct dimensions");
      const groups = new Map<
        string,
        {
          tags: Partial<
            Record<(typeof args.dimensions)[number], string | null>
          >;
          posts: Doc<"posts">[];
        }
      >();
      for (const post of (
        await postsByKind(ctx, "published", since, until).collect()
      ).sort(creationOrder)) {
        if (
          post.status.kind !== "published" ||
          date(post) < since ||
          date(post) >= until ||
          !post.metrics ||
          post.metrics.views < minViews ||
          engagement(post) === null
        )
          continue;
        const tags = Object.fromEntries(
          args.dimensions.map((d) => [d, post.meta?.[d] || null]),
        );
        const key = JSON.stringify(tags);
        const group = groups.get(key) ?? {
          tags,
          posts: new Array<Doc<"posts">>(),
        };
        group.posts.push(post);
        groups.set(key, group);
      }
      const snapshots = (await ctx.db.query("followers").collect()).sort(
        (a, b) => a.at - b.at,
      );
      const start = Number.isFinite(since)
        ? snapshots.filter((s) => s.at <= since).at(-1)
        : snapshots[0];
      const end = snapshots.filter((s) => s.at < until).at(-1);
      return {
        groups: [...groups.values()].map(({ tags, posts }) => {
          posts.sort(
            (a, b) =>
              (engagement(b) ?? 0) - (engagement(a) ?? 0) || date(b) - date(a),
          );
          const totalViews = posts.reduce(
            (sum, p) => sum + (p.metrics?.views ?? 0),
            0,
          );
          return {
            tags,
            count: posts.length,
            totalViews,
            averageViews: totalViews / posts.length,
            averageEngagement:
              posts.reduce((sum, p) => sum + (engagement(p) ?? 0), 0) /
              posts.length,
            bestPostId: posts[0]._id,
          };
        }),
        followers: {
          start: start ? { at: start.at, count: start.count } : null,
          end: end ? { at: end.at, count: end.count } : null,
        },
      };
    },
  ),
);

// Run after deployment until done=true. Each call commits at most 100 legacy rows.
// Live writers claim their row in the same transaction, so retries cannot double count.
export const backfillPostStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const result = await unindexedPosts(ctx).paginate({
      numItems: 100,
      cursor: null,
      maximumBytesRead: 1_000_000,
    });
    for (const post of result.page) await patchPost(ctx, post._id, {});
    return { indexed: result.page.length, done: result.isDone };
  },
});
