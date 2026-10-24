import { v, type ObjectType, type PropertyValidators } from "convex/values";
import { internal } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import {
  resolveAccess,
  type Access,
  type OwnedActionCtx,
  type OwnedMutationCtx,
  type OwnedQueryCtx,
} from "./access";

export function ownerQuery<A extends PropertyValidators, R>(
  args: A,
  handler: (ctx: OwnedQueryCtx, args: ObjectType<A>) => R,
) {
  return query({
    args: { ...args, secret: v.optional(v.string()) },
    handler: async (ctx, values): Promise<R> => {
      return handler(
        { ...ctx, ...(await resolveAccess(ctx, values.secret)) },
        values,
      );
    },
  });
}
export function ownerMutation<A extends PropertyValidators, R>(
  args: A,
  handler: (ctx: OwnedMutationCtx, args: ObjectType<A>) => R,
) {
  return mutation({
    args: { ...args, secret: v.optional(v.string()) },
    handler: async (ctx, values): Promise<R> => {
      return handler(
        { ...ctx, ...(await resolveAccess(ctx, values.secret)) },
        values,
      );
    },
  });
}
export function ownerAction<A extends PropertyValidators, R>(
  args: A,
  handler: (ctx: OwnedActionCtx, args: ObjectType<A>) => R,
) {
  return action({
    args: { ...args, secret: v.optional(v.string()) },
    handler: async (ctx, values): Promise<R> => {
      const access: Access = await ctx.runQuery(internal.access.resolve, {
        secret: values.secret,
      });
      return handler({ ...ctx, ...access }, values);
    },
  });
}
