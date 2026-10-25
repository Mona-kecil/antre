import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const fanOut = internalMutation({
  args: {
    kind: v.union(
      v.literal("refresh"),
      v.literal("sync"),
      v.literal("replies"),
    ),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { kind, cursor }) => {
    const page = await ctx.db
      .query("account")
      .paginate({ cursor: cursor ?? null, numItems: 50 });
    for (const account of page.page) {
      if (
        !account.workspaceId ||
        !account.accessToken ||
        account.needsReconnect
      )
        continue;
      const workspace = await ctx.db.get(account.workspaceId);
      if (!workspace || workspace.state !== "active" || !workspace.ownerId)
        continue;
      const args = { workspaceId: workspace._id };
      switch (kind) {
        case "refresh":
          await ctx.scheduler.runAfter(
            0,
            internal.publishing.refreshToken,
            args,
          );
          break;
        case "sync":
          await ctx.scheduler.runAfter(0, internal.sync.run, args);
          break;
        case "replies":
          await ctx.scheduler.runAfter(0, internal.replies.sync, args);
          break;
      }
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.maintenance.fanOut, {
        kind,
        cursor: page.continueCursor,
      });
  },
});

export const expireReceipts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const receipts = await ctx.db
      .query("providerReceipts")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(100);
    for (const receipt of receipts) await ctx.db.delete(receipt._id);
    if (receipts.length === 100)
      await ctx.scheduler.runAfter(0, internal.maintenance.expireReceipts, {});
  },
});
