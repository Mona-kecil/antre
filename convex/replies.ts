import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  mutation,
  type MutationCtx,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { withSecret } from "./auth";
import { accountState } from "./lib/scheduling";
import { publishContainer, threads } from "./publishing";
import { replyFields } from "./schema";

const pageSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      text: z.string().nullish(),
      username: z.string().nullish(),
      timestamp: z
        .string()
        .refine((value) => Number.isFinite(Date.parse(value))),
      permalink: z.string().nullish(),
      replied_to: z.object({ id: z.string() }).nullish(),
      is_reply_owned_by_me: z.boolean().nullish(),
      hide_status: z.string().nullish(),
    }),
  ),
  paging: z
    .object({
      cursors: z.object({ after: z.string().optional() }).optional(),
      next: z.string().optional(),
    })
    .optional(),
});

export const upsert = internalMutation({
  args: {
    replies: v.array(
      v.object({
        ...replyFields,
        mine: v.optional(v.boolean()),
        hidden: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, { replies }) => {
    let count = 0;
    for (const reply of replies) {
      if (!(await ctx.db.get(reply.postId))) continue;
      const existing = await ctx.db
        .query("replies")
        .withIndex("by_threadsId", (q) => q.eq("threadsId", reply.threadsId))
        .unique();
      const value = {
        ...reply,
        permalink: reply.permalink ?? existing?.permalink,
        repliedToId: reply.repliedToId ?? existing?.repliedToId,
        mine: reply.mine ?? existing?.mine ?? false,
        hidden: reply.hidden ?? existing?.hidden ?? false,
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert("replies", value);
      count++;
    }
    return count;
  },
});

export const targets = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("posts").collect()).filter(
      (post) =>
        post.status.kind === "published" &&
        post.status.at >= Date.now() - 7 * 86_400_000 &&
        post.publishedIds[0],
    ),
});

export const markSynced = internalMutation({
  args: { at: v.number() },
  handler: async (ctx, { at }) => {
    const account = await ctx.db.query("account").unique();
    if (account) await ctx.db.patch(account._id, { repliesSyncedAt: at });
  },
});

async function readyAccount(ctx: ActionCtx) {
  const account = await ctx.runQuery(internal.publishing.getAccount, {});
  if (
    !account ||
    account.needsReconnect ||
    account.tokenExpiresAt <= Date.now()
  )
    throw new Error("Threads account needs reconnecting");
  return account;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx): Promise<{ replies: number; error: string | null }> => {
    let replies = 0;
    const startedAt = Date.now();
    const errors = new Set<string>();
    try {
      const account = await readyAccount(ctx);
      for (const post of await ctx.runQuery(internal.replies.targets, {})) {
        try {
          let after: string | undefined;
          const seen = new Set<string>();
          do {
            const parsed = pageSchema.safeParse(
              await threads(
                `${post.publishedIds[0]}/conversation`,
                account.accessToken,
                {
                  fields:
                    "id,text,username,timestamp,permalink,replied_to,is_reply_owned_by_me,hide_status",
                  limit: "100",
                  ...(after ? { after } : {}),
                },
              ),
            );
            if (!parsed.success)
              throw new Error("Threads returned invalid replies or pagination");
            const page = parsed.data;
            replies += await ctx.runMutation(internal.replies.upsert, {
              replies: page.data.map((reply) => ({
                threadsId: reply.id,
                postId: post._id,
                text: reply.text ?? "",
                username: reply.username ?? "",
                at: Date.parse(reply.timestamp),
                ...(reply.permalink ? { permalink: reply.permalink } : {}),
                ...(reply.replied_to
                  ? { repliedToId: reply.replied_to.id }
                  : {}),
                // Self-thread parts remain ours even if the ownership field is absent.
                mine:
                  post.publishedIds.includes(reply.id) ||
                  reply.username === account.username
                    ? true
                    : (reply.is_reply_owned_by_me ?? undefined),
                ...(reply.hide_status == null
                  ? {}
                  : {
                      // Hidden by the owner, Threads' filter, or a block/restriction.
                      hidden: !["NOT_HUSHED", "UNHUSHED"].includes(
                        reply.hide_status,
                      ),
                    }),
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
        } catch (error) {
          errors.add(
            `Replies (${post.publishedIds[0]}): ${
              error instanceof Error
                ? error.message.replaceAll(account.accessToken, "[redacted]")
                : "Threads request failed"
            }`,
          );
        }
      }
      if (!errors.size)
        await ctx.runMutation(internal.replies.markSynced, { at: startedAt });
    } catch (error) {
      errors.add(error instanceof Error ? error.message : "Reply sync failed");
    }
    return { replies, error: errors.size ? [...errors].join("; ") : null };
  },
});

export const list = query(
  withSecret(
    {
      unanswered: v.optional(v.boolean()),
      drafted: v.optional(v.boolean()),
      postId: v.optional(v.id("posts")),
      offset: v.optional(v.number()),
      limit: v.optional(v.number()),
    },
    async (ctx: QueryCtx, args) => {
      const limit = args.limit ?? 50;
      const offset = args.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error("Offset must be a nonnegative integer");
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error("Limit must be a positive integer");
      const replies = await ctx.db.query("replies").collect();
      const byId = new Map(replies.map((reply) => [reply.threadsId, reply]));
      const answered = new Set(
        replies.filter((reply) => reply.mine).map((reply) => reply.repliedToId),
      );
      const posts = new Map(
        (await ctx.db.query("posts").collect()).map((post) => [post._id, post]),
      );
      const account = await ctx.db.query("account").unique();
      const filtered = replies
        .filter(
          (reply) =>
            posts.has(reply.postId) &&
            (!args.postId || reply.postId === args.postId) &&
            (!args.drafted ||
              reply.draft !== undefined ||
              reply.sending !== undefined) &&
            (!(args.unanswered ?? true) ||
              (!reply.mine && !reply.hidden && !answered.has(reply.threadsId))),
        )
        .sort(
          (a, b) =>
            b.at - a.at ||
            b._creationTime - a._creationTime ||
            a._id.localeCompare(b._id),
        );
      return {
        account: accountState(account),
        total: filtered.length,
        syncedAt:
          account?.repliesSyncedAt === undefined
            ? null
            : new Date(account.repliesSyncedAt).toISOString(),
        replies: filtered.slice(offset, offset + limit).map((reply) => {
          const post = posts.get(reply.postId);
          return {
            replyId: reply.threadsId,
            username: reply.username,
            text: reply.text,
            at: new Date(reply.at).toISOString(),
            permalink: reply.permalink ?? null,
            hidden: reply.hidden,
            draft: reply.draft ?? null,
            sending: reply.sending ?? null,
            parentText:
              reply.repliedToId === post?.publishedIds[0]
                ? (post?.parts[0]?.text ?? "")
                : (byId.get(reply.repliedToId ?? "")?.text ?? null),
            postId: reply.postId,
            postText: post?.parts[0]?.text ?? "",
          };
        }),
      };
    },
  ),
);

async function getReply(ctx: QueryCtx, replyId: string) {
  const reply = await ctx.db
    .query("replies")
    .withIndex("by_threadsId", (q) => q.eq("threadsId", replyId))
    .unique();
  if (!reply || !(await ctx.db.get(reply.postId)))
    throw new Error("Reply not found; run sync_now");
  return reply;
}

export const get = internalQuery({
  args: { replyId: v.string() },
  handler: async (ctx, { replyId }) => getReply(ctx, replyId),
});

export const saveDraft = mutation(
  withSecret(
    { replyId: v.string(), text: v.string() },
    async (ctx: MutationCtx, { replyId, text }) => {
      if (!text.trim() || [...text].length > 500)
        throw new Error("Use 1–500 characters");
      const target = await getReply(ctx, replyId);
      if (target.mine)
        throw new Error("Cannot draft an answer to your own reply");
      if (target.sending !== undefined)
        throw new Error(
          "A send is in progress for this reply; discard it if stuck for 15 minutes",
        );
      await ctx.db.patch(target._id, { draft: text });
    },
  ),
);

export const discardDraft = mutation(
  withSecret({ replyId: v.string() }, async (ctx: MutationCtx, { replyId }) => {
    const target = await getReply(ctx, replyId);
    // Convex stops actions after 10 minutes, so an older marker belongs to a send that died.
    const stuck = (target.sendingAt ?? 0) < Date.now() - 15 * 60_000;
    await ctx.db.patch(target._id, {
      draft: undefined,
      ...(stuck ? { sending: undefined, sendingAt: undefined } : {}),
    });
  }),
);

export const claimDraft = internalMutation({
  args: { replyId: v.string(), text: v.string() },
  handler: async (ctx, { replyId, text }) => {
    const target = await getReply(ctx, replyId);
    if (target.mine)
      throw new Error("Cannot send an answer to your own reply");
    if (target.draft === undefined || target.sending !== undefined)
      throw new Error("No saved draft for this reply");
    if (target.draft !== text)
      throw new Error("Draft changed; review it again before sending");
    await ctx.db.patch(target._id, {
      draft: undefined,
      sending: text,
      sendingAt: Date.now(),
    });
    return target;
  },
});

export const restoreDraft = internalMutation({
  args: { replyId: v.string(), text: v.string() },
  handler: async (ctx, { replyId, text }) => {
    const target = await getReply(ctx, replyId);
    if (target.sending === text)
      await ctx.db.patch(target._id, {
        draft: target.draft ?? text,
        sending: undefined,
        sendingAt: undefined,
      });
  },
});

export const recordSent = internalMutation({
  args: { row: v.object({ ...replyFields, repliedToId: v.string() }) },
  handler: async (ctx, { row }) => {
    const existing = await ctx.db
      .query("replies")
      .withIndex("by_threadsId", (q) => q.eq("threadsId", row.threadsId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("replies", row);
    const target = await ctx.db
      .query("replies")
      .withIndex("by_threadsId", (q) => q.eq("threadsId", row.repliedToId))
      .unique();
    if (target?.sending === row.text)
      await ctx.db.patch(target._id, {
        sending: undefined,
        sendingAt: undefined,
      });
  },
});

export const sendDraft = action(
  withSecret(
    { replyId: v.string(), text: v.string() },
    async (
      ctx: ActionCtx,
      { replyId, text },
    ): Promise<{ replyId: string; permalink: string | null }> => {
      const account = await readyAccount(ctx);
      const target = await ctx.runMutation(internal.replies.claimDraft, {
        replyId,
        text,
      });
      let threadsId: string;
      try {
        threadsId = await publishContainer({
          threadsUserId: account.threadsUserId,
          accessToken: account.accessToken,
          params: { media_type: "TEXT", text, reply_to_id: replyId },
        });
      } catch (error) {
        await ctx.runMutation(internal.replies.restoreDraft, { replyId, text });
        throw new Error(
          error instanceof Error
            ? error.message.replaceAll(account.accessToken, "[redacted]")
            : "Reply publishing failed",
        );
      }
      const row = {
        threadsId,
        postId: target.postId,
        text,
        username: account.username,
        at: Date.now(),
        repliedToId: replyId,
        mine: true,
        hidden: false,
      };
      // Record publication before the optional permalink lookup can fail.
      await ctx.runMutation(internal.replies.recordSent, { row });
      let permalink: string | null = null;
      try {
        const body = await threads(threadsId, account.accessToken, {
          fields: "permalink",
        });
        const parsed = z
          .object({ permalink: z.string().nullish() })
          .parse(body);
        permalink = parsed.permalink ?? null;
        if (permalink)
          await ctx.runMutation(internal.replies.upsert, {
            replies: [{ ...row, permalink }],
          });
      } catch {
        // Publication succeeded; the agent must not retry because a link lookup failed.
      }
      return { replyId: threadsId, permalink };
    },
  ),
);

export const setHidden = internalMutation({
  args: { replyId: v.string(), hidden: v.boolean() },
  handler: async (ctx, { replyId, hidden }) => {
    const reply = await ctx.db
      .query("replies")
      .withIndex("by_threadsId", (q) => q.eq("threadsId", replyId))
      .unique();
    if (reply) await ctx.db.patch(reply._id, { hidden });
  },
});

export const hide = action(
  withSecret(
    { replyId: v.string(), hide: v.boolean() },
    async (ctx: ActionCtx, { replyId, hide }): Promise<{ hidden: boolean }> => {
      await ctx.runQuery(internal.replies.get, { replyId });
      const account = await readyAccount(ctx);
      try {
        const body = await threads(
          `${replyId}/manage_reply`,
          account.accessToken,
          { hide: String(hide) },
          "POST",
        );
        if (!z.object({ success: z.literal(true) }).safeParse(body).success)
          throw new Error(
            "Threads did not confirm the reply visibility change",
          );
        await ctx.runMutation(internal.replies.setHidden, {
          replyId,
          hidden: hide,
        });
        return { hidden: hide };
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? error.message.replaceAll(account.accessToken, "[redacted]")
            : "Reply visibility change failed",
        );
      }
    },
  ),
);
