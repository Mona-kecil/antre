import { error, fail } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convex } from "#lib/server/convex.ts";
import { owner, reason, requireOwner } from "#lib/server/owner.ts";
import { dayStart, isoDay, parseLocal, when } from "#lib/time.ts";
import { topicTagSchema } from "#lib/topicTag.ts";
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
  const { client, secret } = convex();
  const editId = url.searchParams.get("edit");
  const today = dayStart(Date.now());
  const [lookup, schedule] = await Promise.all([
    editId ? client.query(api.posts.getPosts, { secret, ids: [editId] }) : null,
    client.query(api.posts.schedule, {
      secret,
      from: today,
      days: 1,
      day: today,
    }),
  ]);
  requireOwner(locals.userId, schedule.account);
  const post = lookup?.posts.find(
    (post) =>
      post?.id === editId &&
      (post.status.kind === "draft" || post.status.kind === "failed"),
  );
  if (editId && !post)
    error(404, "This draft is gone or already scheduled. Edit it from Drafts.");
  if (post) requireOwner(locals.userId, lookup?.account ?? null);
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
    nextSlot: schedule.nextSlot,
  };
};

export const actions: Actions = {
  compose: async ({ request, locals }) => {
    const { client, secret } = await owner(locals.userId);
    const form = await request.formData();
    const mode = z
      .enum(["draft", "queue", "schedule", "now"])
      .safeParse(form.get("mode"));
    const parts = partsSchema.safeParse(
      JSON.parse(String(form.get("parts") ?? "null")),
    );
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
      at = parseLocal(String(form.get("at") ?? "")) ?? undefined;
      if (at === undefined || at <= Date.now())
        return fail(400, { error: "Choose a time in the future (WIB)." });
    }
    const meta = Object.fromEntries(
      metaKeys.flatMap((key) => {
        const value = String(form.get(key) ?? "").trim();
        return value ? [[key, value]] : [];
      }),
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
          meta,
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
          message: `Queued for ${when(queuedAt)}`,
          next: `/schedule?day=${isoDay(queuedAt)}`,
        };
      }
      if (mode.data === "now") {
        await client.mutation(api.posts.publishNow, { secret, id });
        return { message: "Publishing now…", next: "/schedule" };
      }
      return { message: "Draft saved", next: "/" };
    } catch (cause) {
      return fail(400, {
        draftId: id,
        error: `Saved as a draft, but ${reason(cause, "that time isn't available").replace(/^./, (c) => c.toLowerCase())}.`,
      });
    }
  },
};
