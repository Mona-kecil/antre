import { api } from "../../../convex/_generated/api";
import { owner } from "#lib/server/owner.ts";
import { postAction } from "#lib/server/postActions.ts";
import { DAY, dayStart, parseDay } from "#lib/time.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, locals }) => {
  const { client, secret } = await owner(locals.userId);
  const today = dayStart(Date.now());
  const day = parseDay(url.searchParams.get("day")) ?? today;
  // The strip shows the 7-day week, counted from today, that contains `day`.
  const from = today + Math.floor((day - today) / (7 * DAY)) * 7 * DAY;
  const schedule = await client.query(api.posts.schedule, {
    secret,
    from,
    days: 7,
    day,
  });
  return { ...schedule, day, from, today };
};

export const actions: Actions = { post: postAction };
