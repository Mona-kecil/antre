import { fail } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { owner, reason } from "#lib/server/owner.ts";
import { parseLocal } from "#lib/time.ts";
import type { Actions, PageServerLoad } from "./$types";

const viewSchema = z.enum(["drafts", "scheduled", "published", "failed"]);
const operationSchema = z.enum([
  "queue",
  "unqueue",
  "publishNow",
  "retry",
  "deletePost",
]);

export const load: PageServerLoad = async ({ locals, url }) => {
  const { client, secret } = await owner(locals.userId);
  const view = viewSchema.catch("drafts").parse(url.searchParams.get("view"));
  const offset = z.coerce
    .number()
    .int()
    .nonnegative()
    .catch(0)
    .parse(url.searchParams.get("offset"));
  const list = await client.query(api.linkedin.list, {
    secret,
    view,
    offset,
    limit: 20,
  });
  return { ...list, connection: list.account, view, offset, limit: 20 };
};

export const actions: Actions = {
  post: async ({ locals, request }) => {
    const { client, secret } = await owner(locals.userId);
    const settings = await client.query(api.linkedin.getSettings, { secret });
    const form = await request.formData();
    const operation = operationSchema.safeParse(form.get("operation"));
    const parsedId = z.string().min(1).safeParse(form.get("id"));
    if (!operation.success || !parsedId.success)
      return fail(400, { error: "Choose a post and action." });
    const id = parsedId.data as Id<"linkedinPosts">;
    try {
      switch (operation.data) {
        case "queue": {
          const value = String(form.get("at") ?? "");
          const at = value ? parseLocal(value, settings.timeZone) : undefined;
          if (value && (at === null || at === undefined || at <= Date.now()))
            return fail(400, {
              error: "Choose a future time in the LinkedIn time zone.",
            });
          await client.mutation(api.linkedin.queue, {
            secret,
            id,
            ...(at === undefined || at === null ? {} : { at }),
          });
          return { message: "Added to the LinkedIn schedule" };
        }
        case "unqueue":
          await client.mutation(api.linkedin.unqueue, { secret, id });
          break;
        case "publishNow":
          await client.mutation(api.linkedin.publishNow, { secret, id });
          break;
        case "retry":
          await client.mutation(api.linkedin.retry, {
            secret,
            id,
            confirmDuplicateRisk: form.get("confirmDuplicateRisk") === "on",
            expectedStartedAt: form.has("retryAttempt")
              ? Number(form.get("retryAttempt"))
              : undefined,
          });
          break;
        case "deletePost":
          await client.mutation(api.linkedin.deletePost, { secret, id });
          break;
      }
      return {
        message:
          operation.data === "publishNow" || operation.data === "retry"
            ? "Publishing to LinkedIn…"
            : "LinkedIn post updated",
      };
    } catch (cause) {
      return fail(400, {
        error: reason(cause, "Couldn't update this LinkedIn post. Try again."),
      });
    }
  },
};
