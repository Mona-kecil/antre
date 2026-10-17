import { v, type ObjectType, type PropertyValidators } from "convex/values";

export function withSecret<Args extends PropertyValidators, Ctx, Result>(
  args: Args,
  handler: (ctx: Ctx, args: ObjectType<Args>) => Result,
) {
  return {
    args: { ...args, secret: v.string() },
    handler: (ctx: Ctx, args: ObjectType<Args> & { secret: string }) => {
      if (
        !process.env.ANTRE_SECRET ||
        args.secret !== process.env.ANTRE_SECRET
      ) {
        throw new Error("Unauthorized");
      }
      return handler(ctx, args);
    },
  };
}
