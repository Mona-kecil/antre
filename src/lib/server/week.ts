import { api } from "../../../convex/_generated/api";
import { calendarDay, calendarDistance } from "#lib/calendar.ts";
import { dayStart, parseDay } from "#lib/time.ts";
import type { Week } from "#lib/week.ts";
import type { authenticatedConvex } from "./convex.ts";

type Client = ReturnType<typeof authenticatedConvex>;

// The week is the 7-day block, counted from today, that contains the chosen day.
// The Schedule page uses the same rule, so the sidebar and the page agree.
function frame(url: URL, timeZone: string) {
  const today = dayStart(Date.now(), timeZone);
  const day = parseDay(url.searchParams.get("day"), timeZone) ?? today;
  const from = calendarDay(
    today,
    Math.floor(calendarDistance(today, day, timeZone) / 7) * 7,
    timeZone,
  );
  return { today, day, from };
}

export async function threadsWeek(
  { client, secret }: Client,
  url: URL,
  timeZone: string,
): Promise<Week> {
  const { today, day, from } = frame(url, timeZone);
  const schedule = await client.query(api.posts.schedule, {
    secret,
    from,
    days: 7,
  });
  const { windows, intervalMinutes } = schedule.settings;
  return {
    channel: "threads",
    from,
    day,
    today,
    nextSlot: schedule.nextSlot,
    settings: { windows, intervalMinutes, timeZone },
    marks: schedule.days.flatMap(({ posts }) =>
      posts.flatMap((post) =>
        post.status.kind === "draft"
          ? []
          : [
              {
                id: post.id,
                at: post.at,
                kind: post.status.kind,
                pinned: post.status.kind === "queued" && post.pinned,
                topic: post.meta.topic ?? null,
                text: post.parts[0]?.text ?? "",
              },
            ],
      ),
    ),
  };
}

export async function linkedinWeek(
  { client, secret }: Client,
  url: URL,
  timeZone: string,
) {
  const { today, day, from } = frame(url, timeZone);
  const until = calendarDay(from, 7, timeZone);
  const [scheduled, published, failed] = await Promise.all(
    (["scheduled", "published", "failed"] as const).map((view) =>
      client.query(api.linkedin.list, { secret, view, limit: 100 }),
    ),
  );
  const { windows, intervalMinutes } = scheduled.settings;
  const week: Week = {
    channel: "linkedin",
    from,
    day,
    today,
    nextSlot: scheduled.nextSlot,
    settings: { windows, intervalMinutes, timeZone },
    marks: [...scheduled.items, ...published.items, ...failed.items].flatMap(
      (post) =>
        post.status.kind === "draft" ||
        post.at === null ||
        post.at < from ||
        post.at >= until
          ? []
          : [
              {
                id: post.id,
                at: post.at,
                kind: post.status.kind,
                pinned: post.pinned,
                topic: post.topic ?? null,
                text: post.text,
              },
            ],
    ),
  };
  return { week, drafts: scheduled.counts.drafts, settings: scheduled.settings };
}
