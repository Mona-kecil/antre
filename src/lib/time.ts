import { DEFAULT_TIME_ZONE, localInstant, zoned } from "./timezone";
import { slotsForDay } from "./domain/scheduling";
export const DAY = 86_400_000;
export function wib(at: number) {
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: DEFAULT_TIME_ZONE,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(at) + " WIB"
  );
}
export const clock = (at: number, timeZone = DEFAULT_TIME_ZONE) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
export const dayLabel = (at: number, timeZone = DEFAULT_TIME_ZONE) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(at)
    .replace(",", "");
export function when(
  at: number,
  now = Date.now(),
  timeZone = DEFAULT_TIME_ZONE,
) {
  const days = zoned(now, timeZone)
    .toPlainDate()
    .until(zoned(at, timeZone).toPlainDate()).days;
  const day =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : `${dayLabel(at, timeZone)},`;
  return `${day} ${clock(at, timeZone)}`;
}
export const dayStart = (at: number, timeZone = DEFAULT_TIME_ZONE) =>
  zoned(at, timeZone).startOfDay().epochMilliseconds;
export const isoDay = (at: number, timeZone = DEFAULT_TIME_ZONE) =>
  zoned(at, timeZone).toPlainDate().toString();
export function parseDay(value: string | null, timeZone = DEFAULT_TIME_ZONE) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return localInstant(`${value}T00:00`, timeZone);
}
export const localInput = (at: number, timeZone = DEFAULT_TIME_ZONE) =>
  zoned(at, timeZone).toPlainDateTime().toString({ smallestUnit: "minute" });
export function parseLocal(value: string, timeZone = DEFAULT_TIME_ZONE) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return localInstant(value, timeZone);
}
export function ago(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d`;
  return dayLabel(at).split(" ").slice(1).join(" ");
}
export function minutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
export function slots(
  day: number,
  settings: {
    windows: { start: string; end: string }[];
    intervalMinutes: number;
    timeZone?: string;
  },
) {
  const timeZone = settings.timeZone ?? DEFAULT_TIME_ZONE;
  return slotsForDay({ ...settings, timeZone }, isoDay(day, timeZone));
}
// A `?at=` epoch from a link, kept only while it is in the next year.
// The bound keeps hostile values out of Temporal's supported range.
export function futureTime(value: string | null, now = Date.now()) {
  const at = Number(value);
  return value && Number.isSafeInteger(at) && at > now && at <= now + 366 * DAY
    ? at
    : null;
}
