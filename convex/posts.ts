import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { withSecret } from "./auth";
import { meta, part } from "./schema";

const source = v.optional(v.union(v.literal("web"), v.literal("agent")));

function validateParts(parts: Doc<"posts">["parts"]) {
  if (
    parts.length === 0 ||
    parts.some(({ text }) => text.trim().length === 0 || [...text].length > 500)
  ) {
    throw new Error("Use at least one part, each with 1–500 characters");
  }
}

async function startPublishing(
  ctx: MutationCtx,
  post: Doc<"posts">,
  at: number,
  retry: boolean,
) {
  const startedAt = Date.now();
  await ctx.db.patch(post._id, {
    status: { kind: "publishing", at, startedAt },
    source: post.source,
  });
  await ctx.scheduler.runAfter(0, internal.publishing.publish, {
    id: post._id,
    startedAt,
    retry,
  });
}

export const createDraft = mutation(
  withSecret(
    {
      parts: v.array(part),
      meta: v.optional(meta),
      source: v.union(v.literal("web"), v.literal("agent")),
    },
    async (ctx: MutationCtx, args) => {
      validateParts(args.parts);
      return await ctx.db.insert("posts", {
        parts: args.parts,
        meta: args.meta,
        source: args.source,
        publishedIds: [],
        status: { kind: "draft" },
      });
    },
  ),
);

export const updateDraft = mutation(
  withSecret(
    {
      id: v.id("posts"),
      source,
      parts: v.optional(v.array(part)),
      meta: v.optional(meta),
    },
    async (ctx: MutationCtx, args) => {
      const post = await ctx.db.get(args.id);
      if (
        !post ||
        (post.status.kind !== "draft" && post.status.kind !== "failed")
      ) {
        throw new Error("Only drafts and failed posts can be edited");
      }
      if (args.parts) {
        validateParts(args.parts);
        for (let i = 0; i < post.publishedIds.length; i++) {
          if (
            args.parts[i]?.text !== post.parts[i].text ||
            args.parts[i]?.imageId !== post.parts[i].imageId
          ) {
            throw new Error("Published parts cannot be edited or removed");
          }
        }
      }
      await ctx.db.patch(args.id, {
        ...(args.parts === undefined ? {} : { parts: args.parts }),
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.meta === undefined ? {} : { meta: args.meta }),
      });
    },
  ),
);

export const queue = mutation(
  withSecret(
    { id: v.id("posts"), at: v.optional(v.number()), source },
    async (ctx: MutationCtx, args) => {
      const post = await ctx.db.get(args.id);
      if (
        !post ||
        (post.status.kind !== "draft" && post.status.kind !== "failed")
      ) {
        throw new Error("Only drafts and failed posts can be queued");
      }
      const occupied = new Set(
        (await ctx.db.query("posts").collect()).flatMap(({ status }) =>
          status.kind === "queued" ||
          status.kind === "publishing" ||
          status.kind === "published"
            ? [status.at]
            : [],
        ),
      );
      const now = Date.now();
      let at = args.at;
      if (at === undefined) {
        let settings = await ctx.db.query("settings").unique();
        if (!settings) {
          const id = await ctx.db.insert("settings", {
            timeZone: "Asia/Jakarta",
            windowStart: "06:00",
            windowEnd: "12:00",
            intervalMinutes: 30,
          });
          settings = await ctx.db.get(id);
        }
        if (!settings) throw new Error("Queue settings are missing");
        const [startHour, startMinute] = settings.windowStart
          .split(":")
          .map(Number);
        const [endHour, endMinute] = settings.windowEnd.split(":").map(Number);
        const start = startHour * 60 + startMinute;
        const end = endHour * 60 + endMinute;
        const clock = new Intl.DateTimeFormat("en-GB", {
          timeZone: settings.timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        });
        at = (Math.floor(now / 60_000) + 1) * 60_000;
        for (; ; at += 60_000) {
          const [hour, minute] = clock.format(at).split(":").map(Number);
          const localMinute = hour * 60 + minute;
          if (
            localMinute >= start &&
            localMinute <= end &&
            (localMinute - start) % settings.intervalMinutes === 0 &&
            !occupied.has(at)
          )
            break;
        }
      }
      if (!Number.isFinite(at) || at <= now)
        throw new Error("Queue time must be in the future");
      if (occupied.has(at)) throw new Error("Queue time is already taken");
      const jobId = await ctx.scheduler.runAt(at, internal.posts.fire, {
        id: args.id,
        retry: post.status.kind === "failed" || post.publishedIds.length > 0,
      });
      await ctx.db.patch(args.id, {
        status: { kind: "queued", at, jobId },
        source: args.source ?? post.source,
      });
      return at;
    },
  ),
);

export const unqueue = mutation(
  withSecret(
    { id: v.id("posts"), source },
    async (ctx: MutationCtx, { id, source }) => {
      const post = await ctx.db.get(id);
      if (!post || post.status.kind !== "queued")
        throw new Error("Post is not queued");
      await ctx.scheduler.cancel(post.status.jobId);
      await ctx.db.patch(id, {
        status: { kind: "draft" },
        source: source ?? post.source,
      });
    },
  ),
);

export const publishNow = mutation(
  withSecret(
    { id: v.id("posts"), source },
    async (ctx: MutationCtx, { id, source }) => {
      const post = await ctx.db.get(id);
      if (
        !post ||
        post.status.kind === "publishing" ||
        post.status.kind === "published"
      ) {
        throw new Error("Post cannot be published from this state");
      }
      if (post.status.kind === "queued")
        await ctx.scheduler.cancel(post.status.jobId);
      await startPublishing(
        ctx,
        { ...post, source: source ?? post.source },
        Date.now(),
        post.status.kind === "failed" || post.publishedIds.length > 0,
      );
    },
  ),
);

export const retry = mutation(
  withSecret(
    { id: v.id("posts"), source },
    async (ctx: MutationCtx, { id, source }) => {
      const post = await ctx.db.get(id);
      if (!post || post.status.kind !== "failed")
        throw new Error("Only failed posts can be retried");
      await startPublishing(
        ctx,
        { ...post, source: source ?? post.source },
        Date.now(),
        true,
      );
    },
  ),
);

export const deletePost = mutation(
  withSecret(
    { id: v.id("posts"), source },
    async (ctx: MutationCtx, { id }) => {
      const post = await ctx.db.get(id);
      if (!post) throw new Error("Post not found");
      if (post.status.kind === "publishing")
        throw new Error("Cannot delete a publishing post");
      if (post.status.kind === "queued")
        await ctx.scheduler.cancel(post.status.jobId);
      await ctx.db.delete(id);
    },
  ),
);

export const listQueue = query(
  withSecret(
    { days: v.optional(v.number()) },
    async (ctx: QueryCtx, { days }) => {
      if (days !== undefined && (!Number.isFinite(days) || days <= 0))
        throw new Error("Days must be positive");
      const until =
        days === undefined ? Infinity : Date.now() + days * 86_400_000;
      return (await ctx.db.query("posts").collect())
        .filter(({ status }) => status.kind === "draft" || status.at <= until)
        .sort(
          (a, b) =>
            (a.status.kind === "draft" ? a._creationTime : a.status.at) -
            (b.status.kind === "draft" ? b._creationTime : b.status.at),
        );
    },
  ),
);

export const fire = internalMutation({
  args: { id: v.id("posts"), retry: v.boolean() },
  handler: async (ctx, { id, retry }) => {
    const post = await ctx.db.get(id);
    if (!post || post.status.kind !== "queued") return;
    await startPublishing(ctx, post, post.status.at, retry);
  },
});
