import { describe, expect, it } from "vitest";
import { futureTime } from "./time.ts";

describe("futureTime", () => {
  const now = 1_800_000_000_000;
  it("keeps a future epoch", () => {
    expect(futureTime(String(now + 60_000), now)).toBe(now + 60_000);
  });
  it("drops missing, malformed, fractional and past values", () => {
    for (const value of [null, "", "soon", "1.5", String(now), String(now - 1)])
      expect(futureTime(value, now)).toBeNull();
  });
});
