import { error, fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { owner, reason } from "#lib/server/owner.ts";
import { parseLocal } from "#lib/time.ts";
import { linkedinTextSchema } from "#lib/linkedin.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const { client, secret } = await owner(locals.userId);
  const editId = url.searchParams.get("edit");
  const [edit, settings, connection] = await Promise.all([
    editId
      ? client.query(api.linkedin.get, {
          secret,
          id: editId as Id<"linkedinPosts">,
        })
      : null,
    client.query(api.linkedin.getSettings, { secret }),
    client.query(api.linkedin.current, { secret }),
  ]);
  if (editId && (!edit || !["draft", "failed"].includes(edit.status.kind)))
    error(404, "This LinkedIn draft is gone or already scheduled.");
  return { edit, settings, connection };
};

export const actions: Actions = {
  save: async ({ locals, request }) => {
    const { client, secret } = await owner(locals.userId);
    const form = await request.formData();
    const parsed = z
      .object({
        text: linkedinTextSchema,
        topic: z.string().trim().max(100),
        notes: z.string().trim().max(5000),
        mode: z.enum(["draft", "queue", "schedule", "now"]),
      })
      .safeParse({
        text: form.get("text"),
        topic: form.get("topic") ?? "",
        notes: form.get("notes") ?? "",
        mode: form.get("mode"),
      });
    if (!parsed.success)
      return fail(400, { error: parsed.error.issues[0].message });
    const { text, topic, notes, mode } = parsed.data;
    let at: number | undefined;
    if (mode === "schedule") {
      at = parseLocal(String(form.get("at") ?? "")) ?? undefined;
      if (at === undefined || at <= Date.now())
        return fail(400, { error: "Choose a future publish time in WIB." });
    }
    let id = String(form.get("id") ?? "") as Id<"linkedinPosts">;
    try {
      if (id)
        await client.mutation(api.linkedin.updateDraft, {
          secret,
          id,
          text,
          topic,
          notes,
        });
      else
        id = await client.mutation(api.linkedin.createDraft, {
          secret,
          text,
          topic,
          notes,
          source: "web",
        });
    } catch (cause) {
      return fail(400, {
        error: reason(cause, "Could not save this LinkedIn draft."),
      });
    }
    try {
      if (mode === "queue" || mode === "schedule")
        await client.mutation(api.linkedin.queue, {
          secret,
          id,
          ...(at === undefined ? {} : { at }),
        });
      else if (mode === "now")
        await client.mutation(api.linkedin.publishNow, { secret, id });
    } catch (cause) {
      return fail(400, {
        draftId: id,
        error: reason(cause, "Draft saved, but publishing could not start."),
      });
    }
    redirect(303, mode === "draft" ? "/linkedin" : "/linkedin?view=scheduled");
  },
};
