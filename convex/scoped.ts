import { v, type ObjectType, type PropertyValidators } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import {
  activeWorkspace,
  connectionActive,
  type OwnedActionCtx,
  type OwnedMutationCtx,
  type OwnedQueryCtx,
} from "./access";
const scopeArgs = {
  workspaceId: v.id("workspaces"),
  expectedToken: v.optional(v.string()),
};
async function check(
  ctx: QueryCtx,
  args: { workspaceId: Id<"workspaces">; expectedToken?: string },
) {
  await activeWorkspace(ctx, args.workspaceId);
  if (
    args.expectedToken !== undefined &&
    !(await connectionActive(ctx, args.workspaceId, args.expectedToken))
  )
    throw new Error("Connection changed");
}
export function workspaceQuery<A extends PropertyValidators, R>(definition: {
  args: A;
  handler: (ctx: OwnedQueryCtx, args: ObjectType<A>) => R;
}) {
  return internalQuery({
    args: { ...definition.args, ...scopeArgs },
    handler: async (ctx, args): Promise<R> => {
      await check(ctx, args);
      return definition.handler(
        { ...ctx, workspaceId: args.workspaceId, via: "user" },
        args,
      );
    },
  });
}
export function workspaceMutation<A extends PropertyValidators, R>(definition: {
  args: A;
  handler: (ctx: OwnedMutationCtx, args: ObjectType<A>) => R;
}) {
  return internalMutation({
    args: { ...definition.args, ...scopeArgs },
    handler: async (ctx, args): Promise<R> => {
      await check(ctx, args);
      return definition.handler(
        { ...ctx, workspaceId: args.workspaceId, via: "user" },
        args,
      );
    },
  });
}
export function workspaceAction<A extends PropertyValidators, R>(definition: {
  args: A;
  handler: (ctx: OwnedActionCtx, args: ObjectType<A>) => R;
}) {
  return internalAction({
    args: { ...definition.args, ...scopeArgs },
    handler: async (ctx, args): Promise<R> => {
      await ctx.runQuery(internal.access.background, {
        workspaceId: args.workspaceId,
        expectedToken: args.expectedToken,
      });
      return definition.handler(
        { ...ctx, workspaceId: args.workspaceId, via: "user" },
        args,
      );
    },
  });
}
