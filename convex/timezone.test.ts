import { expect, test } from "vitest";
import {
  clock,
  dayStart,
  isoDay,
  localInput,
  parseDay,
  parseLocal,
  slots,
  when,
} from "../src/lib/time";
import {
  addLocalDays,
  futureLocalDay,
  validateTimeZone,
} from "../src/lib/timezone";
import { nextSlot } from "./lib/scheduling";
const zone = "America/New_York";
const settings = {
  windows: [{ start: "01:00", end: "04:00" }],
  intervalMinutes: 30,
  timeZone: zone,
  gapPolicy: "keepTimes" as const,
};
test("spring slots skip nonexistent local times and retain the local day across DST", () => {
  const start = parseDay("2026-03-08", zone);
  if (start === null) throw new Error("Missing day");
  expect(slots(start, settings).map((at) => clock(at, zone))).toEqual([
    "01:00",
    "01:30",
    "03:00",
    "03:30",
    "04:00",
  ]);
  expect(parseLocal("2026-03-08T02:30", zone)).toBeNull();
  expect(addLocalDays(start, 1, zone) - start).toBe(23 * 3_600_000);
  expect(
    nextSlot(settings, new Set(), Date.parse("2026-03-08T06:30:00Z")),
  ).toBe(Date.parse("2026-03-08T07:00:00Z"));
  expect(when(parseLocal("2026-03-09T01:30", zone) ?? 0, start, zone)).toBe(
    "Tomorrow 01:30",
  );
});
test("fall slots choose the earlier repeated occurrence and never schedule it twice", () => {
  expect(parseLocal("2026-11-01T01:30", zone)).toBe(
    Date.parse("2026-11-01T05:30:00Z"),
  );
  const start = parseDay("2026-11-01", zone);
  if (start === null) throw new Error("Missing day");
  const grid = slots(start, settings);
  expect(grid.filter((at) => clock(at, zone) === "01:30")).toHaveLength(1);
  expect(addLocalDays(start, 1, zone) - start).toBe(25 * 3_600_000);
  expect(
    nextSlot(settings, new Set(), Date.parse("2026-11-01T05:31:00Z")),
  ).toBe(Date.parse("2026-11-01T07:00:00Z"));
  expect(futureLocalDay(Date.parse("2026-10-31T05:30:00Z"), start, zone)).toBe(
    Date.parse("2026-11-01T05:30:00Z"),
  );
});
test("WIB signatures retain their legacy outputs and malformed dates fail", () => {
  const at = Date.parse("2026-10-20T00:30:00Z");
  expect(clock(at)).toBe("07:30");
  expect(isoDay(at)).toBe("2026-10-20");
  expect(dayStart(at)).toBe(Date.parse("2026-10-19T17:00:00Z"));
  expect(localInput(at)).toBe("2026-10-20T07:30");
  expect(parseLocal(localInput(at))).toBe(at);
  expect(parseDay("2026-02-30")).toBeNull();
  expect(parseLocal("2026-02-30T01:00")).toBeNull();
  expect(() => validateTimeZone("+07:00")).toThrow("IANA");
  expect(() => validateTimeZone("Not/AZone")).toThrow("IANA");
});
