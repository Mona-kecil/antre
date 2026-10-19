import { fail } from "@sveltejs/kit";
import { api } from "../../../convex/_generated/api";
import { owner, reason } from "#lib/server/owner.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const { client, secret } = await owner(locals.userId);
  return {
    settings: await client.query(api.posts.getSettings, { secret }),
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    const { client, secret } = await owner(locals.userId);
    const form = await request.formData();
    const starts = form.getAll("start").map(String);
    const ends = form.getAll("end").map(String);
    const gapPolicy = form.get("gapPolicy");
    if (gapPolicy !== "autoFill" && gapPolicy !== "keepTimes")
      return fail(400, { error: "Choose what happens to missed posts." });
    try {
      await client.mutation(api.posts.updateSettings, {
        secret,
        windows: starts.map((start, index) => ({ start, end: ends[index] ?? "" })),
        intervalMinutes: Number(form.get("intervalMinutes")),
        timeZone: "Asia/Jakarta",
        gapPolicy,
      });
      return { message: "Posting schedule saved" };
    } catch (cause) {
      return fail(400, {
        error: reason(
          cause,
          "Check the windows: each needs a start before its end, and windows can't overlap.",
        ),
      });
    }
  },
};
