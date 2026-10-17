import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { withSecret } from "./auth";

export const connect = mutation(
  withSecret(
    {
      threadsUserId: v.string(),
      username: v.string(),
      accessToken: v.string(),
      tokenExpiresAt: v.number(),
    },
    async (ctx: MutationCtx, args) => {
      const account = await ctx.db.query("account").unique();
      if (account && account.threadsUserId !== args.threadsUserId)
        throw new Error("This app belongs to another Threads account");
      const value = {
        threadsUserId: args.threadsUserId,
        username: args.username,
        accessToken: args.accessToken,
        tokenExpiresAt: args.tokenExpiresAt,
        needsReconnect: false,
      };
      if (account) await ctx.db.patch(account._id, value);
      else await ctx.db.insert("account", value);
    },
  ),
);

export const current = query(
  withSecret({}, async (ctx: QueryCtx) => {
    const account = await ctx.db.query("account").unique();
    return account
      ? {
          threadsUserId: account.threadsUserId,
          username: account.username,
          needsReconnect: account.needsReconnect,
        }
      : null;
  }),
);
