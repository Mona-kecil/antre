import {
  activePosts,
  audienceMetrics,
  creationOrder,
  postsByKind,
  schedulingPosts,
  patchPost,
  insertPost,
  deletePost as removePost,
} from "./lib/postStore";
import { v } from "convex/values";
import { DAY, isoDay, slots } from "../src/lib/time";
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
import { partsWithImages, validateImage } from "./lib/media";
import { meta, part, queueSettings } from "./schema";
import { DEFAULT_TOPIC_TAG, topicTagSchema } from "../src/lib/topicTag";
import {
  accountState,
  compactAfter,
  hold,
  nextSlot,
  needsRecovery,
  occupiedTimes,
  place,
  readSettings,
  releaseHeld,
  startPublishing,
  validateSettings,
  validateTime,
} from "./lib/scheduling";

const source = v.optional(v.union(v.literal("web"), v.literal("agent")));

async function validateParts(ctx: MutationCtx, parts: Doc<"posts">["parts"]) {
  if (
    parts.length === 0 ||
    parts.some(({ text }) => text.trim().length === 0 || [...text].length > 500)
  ) {
    throw new Error("Use at least one part, each with 1–500 characters");
  }
  for (const { imageId } of parts) {
    if (!imageId) continue;
    const image = await ctx.db.system.get(imageId);
    if (!image) throw new Error("Image not found in storage");
    validateImage(image);
  }
}

export const createDraft = mutation(
  withSecret(
    {
      parts: v.array(part),
      topicTag: v.optional(v.string()),
      meta: v.optional(meta),
      source: v.union(v.literal("web"), v.literal("agent")),
    },
    async (ctx: MutationCtx, args) => {
      await validateParts(ctx, args.parts);
      const topicTag = topicTagSchema.parse(args.topicTag ?? DEFAULT_TOPIC_TAG);
      return await insertPost(ctx, {
        parts: args.parts,
        ...(topicTag ? { topicTag } : {}),
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
      topicTag: v.optional(v.string()),
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
        await validateParts(ctx, args.parts);
        for (let i = 0; i < post.publishedIds.length; i++) {
          if (
            args.parts[i]?.text !== post.parts[i].text ||
            args.parts[i]?.imageId !== post.parts[i].imageId
          ) {
            throw new Error("Published parts cannot be edited or removed");
          }
        }
      }
      const topicTag =
        args.topicTag === undefined
          ? post.topicTag
          : topicTagSchema.parse(args.topicTag) || undefined;
      if (post.publishedIds.length > 0 && topicTag !== post.topicTag)
        throw new Error(
          "The topic of a published first post cannot be changed",
        );
      await patchPost(ctx, args.id, {
        ...(args.topicTag === undefined ? {} : { topicTag }),
        ...(args.parts === undefined ? {} : { parts: args.parts }),
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.meta === undefined ? {} : { meta: args.meta }),
      });
    },
  ),
);

export const setTopicTag = mutation(
  withSecret(
    { ids: v.array(v.id("posts")), topicTag: v.string() },
    async (ctx: MutationCtx, { ids, topicTag }) => {
      if (ids.length < 1 || ids.length > 100)
        throw new Error("Use between 1 and 100 post ids");
      const tag = topicTagSchema.parse(topicTag) || undefined;
      const uniqueIds = new Set(ids);
      for (const id of uniqueIds) {
        const post = await ctx.db.get(id);
        if (!post) throw new Error("Post not found");
        if (
          post.status.kind === "publishing" ||
          post.status.kind === "published" ||
          post.publishedIds.length > 0
        )
          throw new Error(
            "The Threads topic can only be set before publishing",
          );
        await patchPost(ctx, id, { topicTag: tag });
      }
      return { updated: uniqueIds.size };
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
      const occupied = occupiedTimes(await schedulingPosts(ctx));
      const at =
        args.at ?? nextSlot(await readSettings(ctx), occupied, Date.now());
      validateTime(at, occupied);
      await place(ctx, post, at, args.at !== undefined);
      if (args.source !== undefined)
        await patchPost(ctx, post._id, { source: args.source });
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
      await patchPost(ctx, id, {
        status: { kind: "draft" },
        source: source ?? post.source,
      });
      await compactAfter(ctx, post.status.at);
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
      const retry = await needsRecovery(ctx, post);
      if (post.status.kind === "queued")
        await ctx.scheduler.cancel(post.status.jobId);
      await startPublishing(
        ctx,
        { ...post, source: source ?? post.source },
        Date.now(),
        retry,
      );
      if (post.status.kind === "queued")
        await compactAfter(ctx, post.status.at);
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
      await removePost(ctx, id);
      if (post.status.kind === "queued")
        await compactAfter(ctx, post.status.at);
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
      const posts = [
        ...(await postsByKind(ctx, "draft").collect()),
        ...(await ctx.db
          .query("posts")
          .withIndex("by_at", (q) =>
            q.gt("status.at", undefined).lte("status.at", until),
          )
          .collect()),
      ]
        .sort(creationOrder)
        .sort(
          (a, b) =>
            (a.status.kind === "draft" ? a._creationTime : a.status.at) -
            (b.status.kind === "draft" ? b._creationTime : b.status.at),
        );
      const account = accountState(await ctx.db.query("account").unique());
      return await Promise.all(
        posts.map(
          async ({
            libraryIndexed: _indexed,
            rootPublishedId: _root,
            ...post
          }) => ({
            ...post,
            at: post.status.kind === "draft" ? null : post.status.at,
            pinned: post.pinned ?? post.status.kind === "queued",
            held: post.status.kind === "held",
            account,
            parts: await partsWithImages(ctx, post.parts),
          }),
        ),
      );
    },
  ),
);

export const getPosts = query(
  withSecret({ ids: v.array(v.string()) }, async (ctx: QueryCtx, { ids }) => {
    if (ids.length < 1 || ids.length > 50)
      throw new Error("Use between 1 and 50 post ids");
    const posts = await Promise.all(
      ids.map(async (value) => {
        const id = ctx.db.normalizeId("posts", value);
        const post = id ? await ctx.db.get(id) : null;
        if (!post) return null;
        const {
          libraryIndexed: _indexed,
          rootPublishedId: _root,
          ...full
        } = post;
        return {
          ...full,
          id: post._id,
          at: post.status.kind === "draft" ? null : post.status.at,
          pinned: post.pinned ?? post.status.kind === "queued",
          held: post.status.kind === "held",
          parts: await partsWithImages(ctx, post.parts),
          meta: post.meta ?? {},
          metrics: audienceMetrics(post),
          permalink:
            post.status.kind === "published" ? post.status.permalink : null,
        };
      }),
    );
    return {
      posts,
      account: accountState(await ctx.db.query("account").unique()),
    };
  }),
);

// With day, return the UI day and strip counts; omit day for the full range.
export const schedule = query(
  withSecret(
    { from: v.number(), days: v.number(), day: v.optional(v.number()) },
    async (ctx: QueryCtx, { from, days, day }) => {
      if (!Number.isSafeInteger(days) || days < 1 || days > 31)
        throw new Error("Days must be an integer between 1 and 31");
      if (
        !Number.isSafeInteger(from) ||
        (day !== undefined && !Number.isSafeInteger(day))
      )
        throw new Error("From and day must be timestamps");
      const until = from + days * 86_400_000;
      const all = await ctx.db
        .query("posts")
        .withIndex("by_at", (q) =>
          q.gte("status.at", from).lt("status.at", until),
        )
        .collect();
      if (day !== undefined && (day < from || day + 86_400_000 > until)) {
        const extra = await ctx.db
          .query("posts")
          .withIndex("by_at", (q) =>
            q.gte("status.at", day).lt("status.at", day + 86_400_000),
          )
          .collect();
        const ids = new Set(all.map((post) => post._id));
        all.push(...extra.filter((post) => !ids.has(post._id)));
      }
      all.sort(creationOrder);
      const active = await activePosts(ctx);
      const futurePublished = await postsByKind(
        ctx,
        "published",
        Date.now(),
      ).collect();
      const settings = await readSettings(ctx);
      const counts = new Array<number>(days).fill(0);
      for (const { status } of all) {
        if (status.kind === "draft") continue;
        const index = Math.floor((status.at - from) / 86_400_000);
        if (index >= 0 && index < days) counts[index]++;
      }
      const posts = all
        .filter(
          (post) =>
            post.status.kind !== "draft" &&
            (day === undefined ||
              (post.status.at >= day && post.status.at < day + DAY)),
        )
        .sort(
          (a, b) =>
            (a.status.kind === "draft" ? 0 : a.status.at) -
            (b.status.kind === "draft" ? 0 : b.status.at),
        );
      const occupied = occupiedTimes([...active, ...futurePublished]);
      const now = Date.now();
      const items = await Promise.all(
        posts.map(async (post) => ({
          id: post._id,
          status: post.status,
          at: post.status.kind === "draft" ? 0 : post.status.at,
          pinned: post.pinned ?? post.status.kind === "queued",
          parts: await partsWithImages(ctx, post.parts),
          topicTag: post.topicTag,
          meta: post.meta ?? {},
          source: post.source,
          metrics: post.metrics ?? null,
        })),
      );
      return {
        settings,
        account: accountState(await ctx.db.query("account").unique()),
        counts,
        held: active.filter((post) => post.status.kind === "held").length,
        nextSlot: nextSlot(settings, occupied, now),
        posts: day === undefined ? [] : items,
        days:
          day === undefined
            ? Array.from({ length: days }, (_, index) => {
                const start = from + index * DAY;
                return {
                  day: isoDay(start),
                  posts: items.filter(
                    (post) => post.at >= start && post.at < start + DAY,
                  ),
                  freeSlots: slots(start, settings).filter(
                    (at) => at > now && !occupied.has(at),
                  ),
                };
              })
            : [],
      };
    },
  ),
);

export const fire = internalMutation({
  args: {
    id: v.id("posts"),
    retry: v.boolean(),
    generation: v.optional(v.number()),
  },
  handler: async (ctx, { id, retry, generation }) => {
    const post = await ctx.db.get(id);
    if (
      !post ||
      post.status.kind !== "queued" ||
      post.status.generation !== generation ||
      post.status.at > Date.now()
    )
      return;
    const account = await ctx.db.query("account").unique();
    if (
      !account ||
      account.needsReconnect ||
      account.tokenExpiresAt <= Date.now()
    ) {
      if (account && account.tokenExpiresAt <= Date.now())
        await ctx.db.patch(account._id, { needsReconnect: true });
      await hold(ctx, post, "Threads account needs reconnecting");
      return;
    }
    await startPublishing(ctx, post, post.status.at, retry);
  },
});

export const retryAutomatic = internalMutation({
  args: { id: v.id("posts"), startedAt: v.number(), attempt: v.number() },
  handler: async (ctx, { id, startedAt, attempt }) => {
    const post = await ctx.db.get(id);
    if (
      !post ||
      post.status.kind !== "publishing" ||
      post.status.startedAt !== startedAt ||
      post.status.attempt !== attempt ||
      post.status.retryAt === undefined ||
      post.status.retryAt > Date.now()
    )
      return;
    await startPublishing(ctx, post, post.status.at, true, attempt);
  },
});

export const move = mutation(
  withSecret(
    { id: v.id("posts"), at: v.optional(v.number()), source },
    async (ctx: MutationCtx, { id, at: requestedAt, source }) => {
      const post = await ctx.db.get(id);
      if (!post || post.status.kind !== "queued")
        throw new Error("Post is not queued");
      const occupied = occupiedTimes(
        (await schedulingPosts(ctx)).filter((p) => p._id !== id),
      );
      const at =
        requestedAt ?? nextSlot(await readSettings(ctx), occupied, Date.now());
      validateTime(at, occupied);
      await place(ctx, post, at, requestedAt !== undefined);
      if (source !== undefined) await patchPost(ctx, id, { source });
      return at;
    },
  ),
);

export const swap = mutation(
  withSecret(
    { id: v.id("posts"), otherId: v.id("posts"), source },
    async (ctx: MutationCtx, { id, otherId, source }) => {
      if (id === otherId) throw new Error("Choose two different queued posts");
      const first = await ctx.db.get(id);
      const second = await ctx.db.get(otherId);
      if (
        !first ||
        !second ||
        first.status.kind !== "queued" ||
        second.status.kind !== "queued"
      )
        throw new Error("Both posts must be queued");
      validateTime(first.status.at, new Set());
      validateTime(second.status.at, new Set());
      await place(ctx, first, second.status.at, second.pinned ?? true);
      await place(ctx, second, first.status.at, first.pinned ?? true);
      if (source !== undefined) {
        await patchPost(ctx, id, { source });
        await patchPost(ctx, otherId, { source });
      }
    },
  ),
);

export const getSettings = query(
  withSecret({}, (ctx: QueryCtx) => readSettings(ctx)),
);

export const updateSettings = mutation(
  withSecret(queueSettings, async (ctx: MutationCtx, args) => {
    const value = validateSettings({
      windows: args.windows,
      intervalMinutes: args.intervalMinutes,
      timeZone: args.timeZone,
      gapPolicy: args.gapPolicy,
    });
    const row = await ctx.db.query("settings").unique();
    if (row) await ctx.db.replace(row._id, value);
    else await ctx.db.insert("settings", value);
    return value;
  }),
);

// Run once after deploying the bridge schema. Safe to rerun.
export const migrateSettings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const value = await readSettings(ctx);
    const row = await ctx.db.query("settings").unique();
    if (row) await ctx.db.replace(row._id, value);
    else await ctx.db.insert("settings", value);
    let pinned = 0;
    let unpinned = 0;
    let recovered = 0;
    for (const post of [
      ...(await postsByKind(ctx, "queued").collect()),
      ...(await postsByKind(ctx, "failed").collect()),
    ]) {
      if (post.status.kind === "queued" && post.pinned === undefined) {
        const isPinned =
          nextSlot(value, new Set(), post.status.at - 1) !== post.status.at;
        await patchPost(ctx, post._id, { pinned: isPinned });
        if (isPinned) pinned++;
        else unpinned++;
      }
      if (
        post.status.kind === "failed" &&
        post.status.error === "Threads account needs reconnecting"
      ) {
        await patchPost(ctx, post._id, {
          status: {
            kind: "held",
            at: post.status.at,
            heldAt: Date.now(),
            reason: post.status.error,
          },
        });
        recovered++;
      }
    }
    const account = await ctx.db.query("account").unique();
    if (
      account &&
      !account.needsReconnect &&
      account.tokenExpiresAt > Date.now()
    )
      await releaseHeld(ctx);
    return {
      settings: value,
      legacyPostsPinned: pinned,
      legacyPostsUnpinned: unpinned,
      authFailuresRecovered: recovered,
    };
  },
});
