import * as env from "$app/env/private";
import { fail } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../../../convex/_generated/api";
import {
  workspaceActions,
  timeZoneSchema,
} from "#lib/server/workspaceActions.ts";
import { owner, reason } from "#lib/server/owner.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const { client, secret } = await owner(locals.userId);
  const [settings, connection] = await Promise.all([
    client.query(api.linkedin.getSettings, { secret }),
    client.query(api.linkedin.current, { secret }),
  ]);
  return {
    settings,
    connection,
    configured: Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),
    result: url.searchParams.get("connection"),
  };
};

export const actions: Actions = {
  disconnect: workspaceActions.disconnect,
  save: async ({ locals, request }) => {
    const { client, secret } = await owner(locals.userId);
    const form = await request.formData();
    const timeZone = timeZoneSchema.safeParse(form.get("timeZone"));
    if (!timeZone.success)
      return fail(400, { error: timeZone.error.issues[0].message });
    const gapPolicy = z
      .enum(["autoFill", "keepTimes"])
      .safeParse(form.get("gapPolicy"));
    if (!gapPolicy.success)
      return fail(400, { error: "Choose what happens to missed posts." });
    const ends = form.getAll("end").map(String);
    try {
      await client.mutation(api.linkedin.updateSettings, {
        secret,
        windows: form
          .getAll("start")
          .map((start, i) => ({ start: String(start), end: ends[i] ?? "" })),
        intervalMinutes: Number(form.get("intervalMinutes")),
        timeZone: timeZone.data,
        gapPolicy: gapPolicy.data,
        topics: String(form.get("topics") ?? "")
          .split("\n")
          .map((topic) => topic.trim())
          .filter(Boolean),
        writingInstructions: String(form.get("writingInstructions") ?? ""),
      });
      return { message: "LinkedIn preferences saved" };
    } catch (cause) {
      return fail(400, {
        error: reason(cause, "Check your LinkedIn posting windows and topics."),
      });
    }
  },
};
