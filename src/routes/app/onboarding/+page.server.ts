import { fail, redirect } from "@sveltejs/kit";
import { api } from "../../../../convex/_generated/api";
import { owner } from "#lib/server/owner.ts";
import { timeZoneSchema } from "#lib/server/workspaceActions.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const { client, secret, account } = await owner(locals.userId);
  return {
    threads: account,
    linkedin: await client.query(api.linkedin.current, { secret }),
  };
};

export const actions: Actions = {
  start: async ({ request, locals }) => {
    const { client } = await owner(locals.userId);
    const form = await request.formData();
    const timeZone = timeZoneSchema.safeParse(form.get("timeZone"));
    if (!timeZone.success)
      return fail(400, { error: timeZone.error.issues[0].message });
    await client.mutation(api.workspaces.updateTimeZone, {
      timeZone: timeZone.data,
    });
    const next = form.get("next");
    if (next === "threads") redirect(303, "/auth/threads");
    if (next === "linkedin") redirect(303, "/auth/linkedin");
    if (next === "linkedinDraft") redirect(303, "/app/linkedin/compose");
    redirect(303, "/app/compose");
  },
};
