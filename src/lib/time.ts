export const DAY = 86_400_000;
const WIB = 7 * 60 * 60_000;

export function wib(at: number) {
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(at) + " WIB"
  );
}

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "06:30" in WIB. */
export const clock = (at: number) => clockFormat.format(at);

/** "Tue 20 Oct" in WIB. */
export const dayLabel = (at: number) => dayFormat.format(at).replace(",", "");

/** "Today 06:30", "Tomorrow 06:30", or "Tue 20 Oct, 06:30". */
export function when(at: number, now = Date.now()) {
  const days = Math.round((dayStart(at) - dayStart(now)) / DAY);
  const day =
    days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${dayLabel(at)},`;
  return `${day} ${clock(at)}`;
}

/** Midnight WIB of the day containing `at`. */
export const dayStart = (at: number) =>
  Math.floor((at + WIB) / DAY) * DAY - WIB;

/** "2026-10-20" for the WIB day containing `at`. */
export const isoDay = (at: number) =>
  new Date(dayStart(at) + WIB).toISOString().slice(0, 10);

/** Midnight WIB for "2026-10-20", or null when malformed. */
export function parseDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = Date.parse(`${value}T00:00:00+07:00`);
  return Number.isFinite(at) ? at : null;
}

/** datetime-local value ("2026-10-20T06:30") for `at` in WIB. */
export const localInput = (at: number) =>
  new Date(at + WIB).toISOString().slice(0, 16);

/** Parses a datetime-local value as WIB. */
export function parseLocal(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const at = Date.parse(`${value}:00+07:00`);
  return Number.isFinite(at) ? at : null;
}

/** Threads-style age: "now", "5m", "3h", "2d", then "20 Oct". */
export function ago(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / 1440)}d`;
  return dayLabel(at).split(" ").slice(1).join(" ");
}

/** Minutes after midnight for "HH:MM". */
export function minutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/** Every grid slot of one WIB day for the queue settings. */
export function slots(
  day: number,
  settings: { windows: { start: string; end: string }[]; intervalMinutes: number },
) {
  const result: number[] = [];
  for (const window of settings.windows)
    for (
      let minute = minutes(window.start);
      minute <= minutes(window.end);
      minute += settings.intervalMinutes
    )
      result.push(day + minute * 60_000);
  return result;
}
