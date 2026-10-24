import { Temporal } from "@js-temporal/polyfill";

export const DEFAULT_TIME_ZONE = "Asia/Jakarta";
export function validateTimeZone(timeZone: string): string {
  if (!timeZone || /^[+-]/.test(timeZone))
    throw new Error("Use an IANA time zone");
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
  } catch {
    throw new Error("Use an IANA time zone");
  }
  return timeZone;
}
export const zoned = (at: number, timeZone = DEFAULT_TIME_ZONE) =>
  Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(timeZone);

export function localInstant(
  value: string,
  timeZone = DEFAULT_TIME_ZONE,
): number | null {
  try {
    const local = Temporal.PlainDateTime.from(value, { overflow: "reject" });
    const earlier = local.toZonedDateTime(timeZone, {
      disambiguation: "earlier",
    });
    if (!earlier.toPlainDateTime().equals(local)) return null;
    return earlier.epochMilliseconds;
  } catch {
    return null;
  }
}
export function addLocalDays(
  at: number,
  days: number,
  timeZone = DEFAULT_TIME_ZONE,
): number {
  return zoned(at, timeZone).add({ days }).epochMilliseconds;
}
export function futureLocalDay(
  at: number,
  now: number,
  timeZone: string,
  minimumDays = 0,
): number {
  const original = zoned(at, timeZone).toPlainDateTime();
  let days = Math.max(
    minimumDays,
    original.toPlainDate().until(zoned(now, timeZone).toPlainDate()).days,
  );
  for (; ; days++) {
    const candidate = localInstant(original.add({ days }).toString(), timeZone);
    if (candidate !== null && candidate > now) return candidate;
  }
}
