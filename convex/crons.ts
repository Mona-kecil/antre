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
crons.daily(
  "sync Threads library",
  { hourUTC: 1, minuteUTC: 0 },
  internal.sync.run,
);
crons.interval("sync Threads replies", { hours: 1 }, internal.replies.sync);
export default crons;
