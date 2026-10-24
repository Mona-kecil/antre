import { Temporal } from "@js-temporal/polyfill";

export function calendarDay(at: number, days: number, timeZone: string) {
  return Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(timeZone)
    .add({ days })
    .startOfDay().epochMilliseconds;
}

export function calendarDistance(from: number, to: number, timeZone: string) {
  const day = (at: number) =>
    Temporal.Instant.fromEpochMilliseconds(at)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate();
  return day(from).until(day(to), { largestUnit: "day" }).days;
}
