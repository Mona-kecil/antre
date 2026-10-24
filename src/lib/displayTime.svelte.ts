import { page } from "$app/state";
import * as time from "./time.ts";

export { DAY, minutes, slots } from "./time.ts";
export const timeZone = () =>
  page.data.settings?.timeZone ??
  page.data.workspace?.timeZone ??
  "Asia/Jakarta";
export const clock = (at: number) => time.clock(at, timeZone());
export const dayLabel = (at: number) => time.dayLabel(at, timeZone());
export const when = (at: number, now = Date.now()) =>
  time.when(at, now, timeZone());
export const dayStart = (at: number) => time.dayStart(at, timeZone());
export const isoDay = (at: number) => time.isoDay(at, timeZone());
export const localInput = (at: number) => time.localInput(at, timeZone());
export function ago(at: number, now = Date.now()) {
  return now - at < 7 * time.DAY
    ? time.ago(at, now)
    : dayLabel(at).split(" ").slice(1).join(" ");
}
