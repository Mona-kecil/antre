import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { withSecret } from "./auth";
import { accountState, releaseHeld } from "./lib/scheduling";

export const connect = mutation(
  withSecret(
    {
      threadsUserId: v.string(),
      username: v.string(),
      accessToken: v.string(),
      tokenExpiresAt: v.number(),
    },
    async (ctx: MutationCtx, args) => {
      if (
        !Number.isFinite(args.tokenExpiresAt) ||
        args.tokenExpiresAt <= Date.now()
      )
        throw new Error("Token must expire in the future");
      const account = await ctx.db.query("account").unique();
      if (account && account.threadsUserId !== args.threadsUserId)
        throw new Error("This app belongs to another Threads account");
      const value = {
        threadsUserId: args.threadsUserId,
        username: args.username,
        accessToken: args.accessToken,
        tokenExpiresAt: args.tokenExpiresAt,
        needsReconnect: false,
        lastRefreshError: undefined,
        lastRefreshErrorAt: undefined,
      };
      if (account) await ctx.db.patch(account._id, value);
      else await ctx.db.insert("account", value);
      await releaseHeld(ctx);
    },
  ),
);

export const current = query(
  withSecret({}, async (ctx: QueryCtx) => {
    const account = await ctx.db.query("account").unique();
    return accountState(account);
  }),
);
