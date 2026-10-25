import { expect, test } from "vitest";
import { calendarDay, calendarDistance } from "./calendar.ts";

test.each([
  {
    day: "2026-03-08T00:00:00-05:00",
    next: "2026-03-09T00:00:00-04:00",
    hours: 23,
  },
  {
    day: "2026-11-01T00:00:00-04:00",
    next: "2026-11-02T00:00:00-05:00",
    hours: 25,
  },
])(
  "calendar navigation crosses the $hours-hour day without changing the local date",
  ({ day, next, hours }) => {
    const start = Date.parse(day),
      end = Date.parse(next);
    expect(calendarDay(start, 1, "America/New_York")).toBe(end);
    expect(calendarDay(end, -1, "America/New_York")).toBe(start);
    expect(calendarDistance(start, end, "America/New_York")).toBe(1);
    expect(end - start).toBe(hours * 3_600_000);
  },
);

test("Jakarta calendar navigation keeps the owner's daily instants", () => {
  const start = Date.parse("2026-10-24T00:00:00+07:00");
  expect(calendarDay(start, 7, "Asia/Jakarta")).toBe(start + 7 * 86_400_000);
  expect(
    calendarDistance(
      start,
      calendarDay(start, 7, "Asia/Jakarta"),
      "Asia/Jakarta",
    ),
  ).toBe(7);
});
