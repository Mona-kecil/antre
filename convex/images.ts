import { mutation, type MutationCtx } from "./_generated/server";
import { withSecret } from "./auth";

export const uploadUrl = mutation(
  withSecret(
    {},
    async (ctx: MutationCtx) => await ctx.storage.generateUploadUrl(),
  ),
);
