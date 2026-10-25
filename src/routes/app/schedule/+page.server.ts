import { api } from "../../../../convex/_generated/api";
import { owner } from "#lib/server/owner.ts";
import { postAction } from "#lib/server/postActions.ts";
import { calendarDay, calendarDistance } from "#lib/calendar.ts";
import { dayStart, parseDay } from "#lib/time.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, locals }) => {
  const { client, secret, account, workspace } = await owner(locals.userId);
  const settings = await client.query(api.posts.getSettings, { secret });
  const today = dayStart(Date.now(), settings.timeZone);
  const day = parseDay(url.searchParams.get("day"), settings.timeZone) ?? today;
  // The strip shows the 7-day week, counted from today, that contains `day`.
  const from = calendarDay(
    today,
    Math.floor(calendarDistance(today, day, settings.timeZone) / 7) * 7,
    settings.timeZone,
  );
  const schedule = await client.query(api.posts.schedule, {
    secret,
    from,
    days: 7,
    day,
  });
  return { ...schedule, day, from, today };
};

export const actions: Actions = { post: postAction };
