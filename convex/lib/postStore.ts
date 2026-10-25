import { compareValues } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { OwnedQueryCtx as QueryCtx } from "../access";

type PostValue = Omit<Doc<"posts">, "_id" | "_creationTime">;
type Stats = Omit<Doc<"postStats">, "_id" | "_creationTime" | "workspaceId">;
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

export function audienceMetrics(
  post: Pick<Doc<"posts">, "metrics" | "publishedIds">,
) {
  if (!post.metrics) return null;
  return {
    ...post.metrics,
    replies: Math.max(
      0,
      post.metrics.replies - Math.max(0, post.publishedIds.length - 1),
    ),
  };
}

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
  workspaceId: Id<"workspaces">,
  before: Doc<"posts"> | null,
  after: PostValue | null,
) {
  const row = await ctx.db
    .query("postStats")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  const stats = row
    ? { counts: row.counts, publishedFacets: row.publishedFacets }
    : emptyStats();
  if (before?.libraryIndexed) contribute(stats, before, -1);
  if (after) contribute(stats, after, 1);
  if (row) await ctx.db.replace(row._id, { ...stats, workspaceId });
  else await ctx.db.insert("postStats", { ...stats, workspaceId });
}

// Every post writer records its contribution in the same transaction.
export async function insertPost(ctx: MutationCtx, value: PostValue) {
  await updateStats(ctx, value.workspaceId, null, value);
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
    await updateStats(ctx, before.workspaceId, before, after);
  await ctx.db.patch(id, {
    ...patch,
    libraryIndexed: true,
    rootPublishedId: after.publishedIds[0],
  });
}

export async function deletePost(ctx: MutationCtx, id: Id<"posts">) {
  const before = await ctx.db.get(id);
  if (!before) return;
  if (before.libraryIndexed)
    await updateStats(ctx, before.workspaceId, before, null);
  const replies = await ctx.db
    .query("replies")
    .withIndex("workspace_by_postId", (q) =>
      q.eq("workspaceId", before.workspaceId).eq("postId", id),
    )
    .collect();
  for (const reply of replies) await ctx.db.delete(reply._id);
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
      .withIndex("workspace_by_kind_at", (q) =>
        q
          .eq("workspaceId", ctx.workspaceId)
          .eq("status.kind", kind)
          .eq("status.at", undefined)
          .gte("_creationTime", since)
          .lt("_creationTime", until),
      );
  return ctx.db
    .query("posts")
    .withIndex("workspace_by_kind_at", (q) =>
      q
        .eq("workspaceId", ctx.workspaceId)
        .eq("status.kind", kind)
        .gte("status.at", since)
        .lt("status.at", until),
    );
}

export async function libraryStats(ctx: QueryCtx) {
  const row = await ctx.db
    .query("postStats")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
    .unique();
  const stats = row
    ? { counts: row.counts, publishedFacets: row.publishedFacets }
    : emptyStats();
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
