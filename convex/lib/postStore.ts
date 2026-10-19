import { compareValues } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type PostValue = Omit<Doc<"posts">, "_id" | "_creationTime">;
type Stats = Omit<Doc<"postStats">, "_id" | "_creationTime">;
export const dimensions = ["topic", "angle", "format"] as const;
export const kinds = [
  "draft",
  "queued",
  "publishing",
  "published",
  "held",
  "failed",
] as const;
export type Kind = Doc<"posts">["status"]["kind"];

export function viewOf(post: Pick<Doc<"posts">, "status">) {
  return viewForKind(post.status.kind);
}

export function viewForKind(kind: Kind) {
  switch (kind) {
    case "draft":
      return "drafts";
    case "queued":
    case "publishing":
    case "held":
      return "scheduled";
    case "published":
      return "published";
    case "failed":
      return "failed";
  }
}

function emptyStats(): Stats {
  return {
    counts: { drafts: 0, scheduled: 0, published: 0, failed: 0 },
    publishedFacets: [],
  };
}

function contribute(
  stats: Stats,
  post: Pick<PostValue, "status" | "meta">,
  delta: number,
) {
  stats.counts[viewOf(post)] += delta;
  if (post.status.kind !== "published") return;
  for (const dimension of dimensions) {
    const code = post.meta?.[dimension];
    if (code === undefined) continue;
    const facet = stats.publishedFacets.find(
      (f) => f.dimension === dimension && f.code === code,
    );
    if (facet) facet.count += delta;
    else stats.publishedFacets.push({ dimension, code, count: delta });
  }
  stats.publishedFacets = stats.publishedFacets.filter((f) => f.count !== 0);
}

async function updateStats(
  ctx: MutationCtx,
  before: Doc<"posts"> | null,
  after: PostValue | null,
) {
  const row = await ctx.db.query("postStats").unique();
  const stats = row
    ? { counts: row.counts, publishedFacets: row.publishedFacets }
    : emptyStats();
  if (before?.libraryIndexed) contribute(stats, before, -1);
  if (after) contribute(stats, after, 1);
  if (row) await ctx.db.replace(row._id, stats);
  else await ctx.db.insert("postStats", stats);
}

// Every post writer, including backfill, records its contribution in the same transaction.
export async function insertPost(ctx: MutationCtx, value: PostValue) {
  await updateStats(ctx, null, value);
  return ctx.db.insert("posts", {
    ...value,
    libraryIndexed: true,
    rootPublishedId: value.publishedIds[0],
  });
}

export async function patchPost(
  ctx: MutationCtx,
  id: Id<"posts">,
  patch: Partial<PostValue>,
) {
  const before = await ctx.db.get(id);
  if (!before) throw new Error("Post not found");
  const after = { ...before, ...patch };
  if (
    !before.libraryIndexed ||
    (patch.status?.kind !== undefined &&
      patch.status.kind !== before.status.kind) ||
    "meta" in patch
  )
    await updateStats(ctx, before, after);
  await ctx.db.patch(id, {
    ...patch,
    libraryIndexed: true,
    rootPublishedId: after.publishedIds[0],
  });
}

export async function deletePost(ctx: MutationCtx, id: Id<"posts">) {
  const before = await ctx.db.get(id);
  if (!before) return;
  if (before.libraryIndexed) await updateStats(ctx, before, null);
  await ctx.db.delete(id);
}

export function postsByKind(
  ctx: QueryCtx,
  kind: Kind,
  since = -Infinity,
  until = Infinity,
) {
  if (kind === "draft")
    return ctx.db
      .query("posts")
      .withIndex("by_kind_at", (q) =>
        q
          .eq("status.kind", kind)
          .eq("status.at", undefined)
          .gte("_creationTime", since)
          .lt("_creationTime", until),
      );
  return ctx.db
    .query("posts")
    .withIndex("by_kind_at", (q) =>
      q.eq("status.kind", kind).gte("status.at", since).lt("status.at", until),
    );
}

export function unindexedPosts(ctx: QueryCtx) {
  return ctx.db
    .query("posts")
    .withIndex("by_libraryIndexed", (q) => q.eq("libraryIndexed", undefined));
}

export async function libraryStats(ctx: QueryCtx) {
  const row = await ctx.db.query("postStats").unique();
  const stats = row
    ? { counts: row.counts, publishedFacets: row.publishedFacets }
    : emptyStats();
  // During the online backfill, include legacy contributions without double counting.
  // Once backfill completes this index range is empty, regardless of history size.
  for (const post of await unindexedPosts(ctx).collect())
    contribute(stats, post, 1);
  return stats;
}

export async function activePosts(ctx: QueryCtx) {
  return (
    await Promise.all(
      (["queued", "publishing", "held"] as const).map((kind) =>
        postsByKind(ctx, kind).collect(),
      ),
    )
  ).flat();
}

export async function schedulingPosts(ctx: QueryCtx) {
  return [
    ...(await activePosts(ctx)),
    ...(await postsByKind(ctx, "published", Date.now()).collect()),
  ];
}

export const creationOrder = (a: Doc<"posts">, b: Doc<"posts">) =>
  a._creationTime - b._creationTime || compareValues(a._id, b._id);
