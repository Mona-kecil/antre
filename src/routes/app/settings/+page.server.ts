import { fail } from "@sveltejs/kit";
import { api } from "../../../../convex/_generated/api";
import {
  workspaceActions,
  timeZoneSchema,
} from "#lib/server/workspaceActions.ts";
import { owner, reason } from "#lib/server/owner.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const { client, secret } = await owner(locals.userId);
  return {
    mcpUrl: `${url.origin}/mcp`,
    settings: await client.query(api.posts.getSettings, { secret }),
    agentGrants: await client.query(api.workspaces.listAgentGrants, {}),
  };
};

export const actions: Actions = {
  ...workspaceActions,
  save: async ({ request, locals }) => {
    const { client, secret } = await owner(locals.userId);
    const form = await request.formData();
    const starts = form.getAll("start").map(String);
    const ends = form.getAll("end").map(String);
    const timeZone = timeZoneSchema.safeParse(form.get("timeZone"));
    if (!timeZone.success)
      return fail(400, { error: timeZone.error.issues[0].message });
    const gapPolicy = form.get("gapPolicy");
    if (gapPolicy !== "autoFill" && gapPolicy !== "keepTimes")
      return fail(400, { error: "Choose what happens to missed posts." });
    try {
      await client.mutation(api.posts.updateSettings, {
        secret,
        windows: starts.map((start, index) => ({
          start,
          end: ends[index] ?? "",
        })),
        intervalMinutes: Number(form.get("intervalMinutes")),
        timeZone: timeZone.data,
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
