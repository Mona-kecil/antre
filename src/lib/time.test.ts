import { describe, expect, it } from "vitest";
import { futureTime } from "./time.ts";

describe("futureTime", () => {
  const now = 1_800_000_000_000;
  it("keeps a future epoch", () => {
    expect(futureTime(String(now + 60_000), now)).toBe(now + 60_000);
  });
  it("drops missing, malformed, fractional, past and far-future values", () => {
    for (const value of [null, "", "soon", "1.5", String(now), String(now - 1), "8640000000000001", String(now + 400 * 86_400_000)])
      expect(futureTime(value, now)).toBeNull();
  });
});
