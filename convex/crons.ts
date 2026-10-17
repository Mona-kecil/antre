import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval(
  "fail stuck posts",
  { minutes: 10 },
  internal.publishing.sweepStuck,
);
crons.weekly(
  "refresh Threads token",
  { dayOfWeek: "monday", hourUTC: 0, minuteUTC: 0 },
  internal.publishing.refreshToken,
);
export default crons;
