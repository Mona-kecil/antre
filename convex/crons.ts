import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval(
  "recover stuck posts",
  { minutes: 10 },
  internal.publishing.sweepStuck,
);
crons.daily(
  "refresh Threads token",
  { hourUTC: 0, minuteUTC: 0 },
  internal.maintenance.fanOut,
  { kind: "refresh" },
);
crons.daily(
  "sync Threads library",
  { hourUTC: 1, minuteUTC: 0 },
  internal.maintenance.fanOut,
  { kind: "sync" },
);
crons.interval(
  "sync Threads replies",
  { hours: 1 },
  internal.maintenance.fanOut,
  { kind: "replies" },
);
crons.interval(
  "hold stuck LinkedIn posts",
  { minutes: 10 },
  internal.linkedin.sweepStuck,
);
crons.daily(
  "expire provider receipts",
  { hourUTC: 2, minuteUTC: 0 },
  internal.maintenance.expireReceipts,
);
export default crons;
