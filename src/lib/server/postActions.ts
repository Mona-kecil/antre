import { fail, type RequestEvent } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { parseLocal, when } from "#lib/time.ts";
import { owner, reason } from "./owner.ts";

const postId = z
  .string()
  .min(1)
  .transform((id) => id as Id<"posts">);

/** A requested time from `at` (datetime-local, channel time zone) or `slot` (epoch ms). */
function requestedTime(form: FormData, timeZone: string) {
  const local = form.get("at");
  if (typeof local === "string" && local) {
    const at = parseLocal(local, timeZone);
    if (at === null) throw new Error("Choose a valid date and time");
    return at;
  }
  const slot = Number(form.get("slot"));
  return form.get("slot") && Number.isSafeInteger(slot) ? slot : undefined;
}

/** The shared `post` form action: every change to one post's schedule. */
export async function postAction({ request, locals }: RequestEvent) {
  const { client, secret } = await owner(locals.userId);
  const settings = await client.query(api.posts.getSettings, { secret });
  const form = await request.formData();
  const operation = String(form.get("operation"));
  try {
    const id = postId.parse(form.get("id"));
    const at = requestedTime(form, settings.timeZone);
    if (at !== undefined && at <= Date.now())
      return fail(400, {
        error: "Choose a time in the future in the channel time zone",
      });
    switch (operation) {
      case "queue": {
        const queuedAt = await client.mutation(api.posts.queue, {
          secret,
          id,
          ...(at === undefined ? {} : { at }),
        });
        return {
          message: `Queued for ${when(queuedAt, Date.now(), settings.timeZone)}`,
          undo: { action: "/app?/post", fields: { id, operation: "unqueue" } },
        };
      }
      case "move": {
        const movedAt = await client.mutation(api.posts.move, {
          secret,
          id,
          ...(at === undefined ? {} : { at }),
        });
        return {
          message: `Moved to ${when(movedAt, Date.now(), settings.timeZone)}`,
        };
      }
      case "swap":
        await client.mutation(api.posts.swap, {
          secret,
          id,
          otherId: postId.parse(form.get("otherId")),
        });
        return { message: "Swapped times" };
      case "unqueue":
        await client.mutation(api.posts.unqueue, { secret, id });
        return { message: "Moved back to drafts" };
      case "retry":
        await client.mutation(api.posts.retry, { secret, id });
        return { message: "Publishing again…" };
      case "now":
        await client.mutation(api.posts.publishNow, { secret, id });
        return { message: "Publishing now…" };
      case "delete":
        await client.mutation(api.posts.deletePost, { secret, id });
        return { message: "Post deleted" };
      default:
        return fail(400, { error: "Unknown post action" });
    }
  } catch (cause) {
    return fail(400, {
      error: reason(
        cause,
        operation === "queue" || operation === "move"
          ? "That time isn't available. Pick a free future time."
          : "Couldn't update this post. Refresh and try again.",
      ),
    });
  }
}
