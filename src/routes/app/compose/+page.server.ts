import { error, fail } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { owner, reason } from "#lib/server/owner.ts";
import { dayStart, isoDay, parseLocal, when } from "#lib/time.ts";
import { topicTagSchema } from "#lib/topicTag.ts";
import { futureTime } from "#lib/time.ts";
import type { Actions, PageServerLoad } from "./$types";

const partsSchema = z
  .array(
    z.object({
      text: z.string().trim().min(1),
      imageId: z
        .string()
        .min(1)
        .optional()
        .transform((id) => id as Id<"_storage"> | undefined),
    }),
  )
  .min(1)
  .refine((parts) => parts.every((part) => [...part.text].length <= 500));
const metaKeys = ["topic", "angle", "format", "hook", "notes"] as const;

export const load: PageServerLoad = async ({ url, locals }) => {
  const { client, secret, account, workspace } = await owner(locals.userId);
  const editId = url.searchParams.get("edit");
  const settings = await client.query(api.posts.getSettings, { secret });
  const today = dayStart(Date.now(), settings.timeZone);
  const [lookup, schedule] = await Promise.all([
    editId ? client.query(api.posts.getPosts, { secret, ids: [editId] }) : null,
    client.query(api.posts.schedule, {
      secret,
      from: today,
      days: 1,
      day: today,
    }),
  ]);
  const post = lookup?.posts.find(
    (post) =>
      post?.id === editId &&
      (post.status.kind === "draft" || post.status.kind === "failed"),
  );
  if (editId && !post)
    error(404, "This draft is gone or already scheduled. Edit it from Drafts.");
  return {
    edit: post
      ? {
          id: post.id,
          failed: post.status.kind === "failed",
          topicTag: post.topicTag ?? "",
          topicTagLocked: post.publishedIds.length > 0,
          parts: post.parts.map((part) => ({
            text: part.text,
            imageId: part.imageId,
            imageUrl: part.imageUrl ?? undefined,
          })),
          meta: post.meta ?? {},
        }
      : null,
    settings,
    nextSlot: schedule.nextSlot,
    preset: futureTime(url.searchParams.get("at")),
  };
};

export const actions: Actions = {
  compose: async ({ request, locals }) => {
    const { client, secret } = await owner(locals.userId);
    const settings = await client.query(api.posts.getSettings, { secret });
    const form = await request.formData();
    const mode = z
      .enum(["draft", "queue", "schedule", "now"])
      .safeParse(form.get("mode"));
    let input: unknown;
    try {
      input = JSON.parse(String(form.get("parts") ?? "null"));
    } catch {
      return fail(400, {
        error: "Could not read this draft. Refresh and try again.",
      });
    }
    const parts = partsSchema.safeParse(input);
    const topicTag = topicTagSchema
      .optional()
      .safeParse(form.get("topicTag") ?? undefined);
    if (!mode.success) return fail(400, { error: "Unknown compose action" });
    if (!parts.success)
      return fail(400, { error: "Every part needs 1–500 characters." });
    if (!topicTag.success)
      return fail(400, { error: topicTag.error.issues[0].message });
    let at: number | undefined;
    if (mode.data === "schedule") {
      at =
        parseLocal(String(form.get("at") ?? ""), settings.timeZone) ??
        undefined;
      if (at === undefined || at <= Date.now())
        return fail(400, {
          error: "Choose a future time in the channel time zone.",
        });
    }
    const meta = Object.fromEntries(
      metaKeys
        .filter((key) => form.has(key))
        .map((key) => [key, String(form.get(key) ?? "").trim()]),
    );
    let id = (String(form.get("id") ?? "") || undefined) as
      Id<"posts"> | undefined;
    try {
      if (id)
        await client.mutation(api.posts.updateDraft, {
          secret,
          id,
          parts: parts.data,
          ...(topicTag.data === undefined ? {} : { topicTag: topicTag.data }),
          meta,
        });
      else
        id = await client.mutation(api.posts.createDraft, {
          secret,
          parts: parts.data,
          ...(topicTag.data === undefined ? {} : { topicTag: topicTag.data }),
          meta: Object.fromEntries(
            Object.entries(meta).filter(([, value]) => value !== ""),
          ),
          source: "web",
        });
    } catch (cause) {
      return fail(400, {
        error: reason(cause, "Couldn't save this post. Try again."),
      });
    }
    try {
      if (mode.data === "queue" || mode.data === "schedule") {
        const queuedAt = await client.mutation(api.posts.queue, {
          secret,
          id,
          ...(at === undefined ? {} : { at }),
        });
        return {
          message: `Queued for ${when(queuedAt, Date.now(), settings.timeZone)}`,
          next: `/app/schedule?day=${isoDay(queuedAt, settings.timeZone)}`,
        };
      }
      if (mode.data === "now") {
        await client.mutation(api.posts.publishNow, { secret, id });
        return { message: "Publishing now…", next: "/app/schedule" };
      }
      return { message: "Draft saved", next: "/app" };
    } catch (cause) {
      return fail(400, {
        draftId: id,
        error: `Saved as a draft, but ${reason(cause, "that time isn't available").replace(/^./, (c) => c.toLowerCase())}.`,
      });
    }
  },
};
