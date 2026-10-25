import { futureLocalDay } from "../../src/lib/timezone";
import { validateSchedulingSettings } from "../../src/lib/domain/scheduling";
export { nextSlot } from "../../src/lib/domain/scheduling";
import { nextSlot } from "../../src/lib/domain/scheduling";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type {
  OwnedMutationCtx as MutationCtx,
  OwnedQueryCtx as QueryCtx,
} from "../access";
import { patchPost, schedulingPosts } from "./postStore";

export type QueueSettings = Doc<"settings">;
type SettingsValue = Omit<
  QueueSettings,
  "_id" | "_creationTime" | "workspaceId"
>;

export const defaultSettings = {
  windows: [{ start: "06:00", end: "12:00" }],
  intervalMinutes: 30,
  timeZone: "Asia/Jakarta",
  gapPolicy: "keepTimes",
} satisfies SettingsValue;

export function validateSettings(value: SettingsValue): SettingsValue {
  return validateSchedulingSettings(value);
}

export async function readSettings(ctx: QueryCtx): Promise<SettingsValue> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
    .unique();
  if (!row) {
    const workspace = await ctx.db.get(ctx.workspaceId);
    if (!workspace) throw new Error("Workspace unavailable");
    return { ...defaultSettings, timeZone: workspace.timeZone };
  }
  return validateSettings({
    windows: row.windows,
    intervalMinutes: row.intervalMinutes,
    timeZone: row.timeZone,
    gapPolicy: row.gapPolicy,
  });
}

export function occupiedTimes(posts: Doc<"posts">[]) {
  return new Set(
    posts.flatMap(({ status }) =>
      status.kind === "queued" ||
      status.kind === "publishing" ||
      status.kind === "published"
        ? [status.at]
        : [],
    ),
  );
}

export function validateTime(at: number, occupied: Set<number>) {
  if (!Number.isFinite(at) || at <= Date.now())
    throw new Error("Queue time must be in the future");
  if (occupied.has(at)) throw new Error("Queue time is already taken");
}

export async function needsRecovery(ctx: QueryCtx, post: Doc<"posts">) {
  if (post.status.kind === "held" || post.status.kind === "publishing")
    return post.status.retry === true || post.publishedIds.length > 0;
  if (post.status.kind !== "queued")
    return post.status.kind === "failed" || post.publishedIds.length > 0;
  if (post.status.retry !== undefined) return post.status.retry;
  // Legacy rows kept the retry flag only in the scheduled job's arguments.
  const job = await ctx.db.system.get(post.status.jobId);
  const args: unknown = job?.args[0];
  return (
    post.publishedIds.length > 0 ||
    (args !== null &&
      typeof args === "object" &&
      "retry" in args &&
      args.retry === true)
  );
}

export async function place(
  ctx: MutationCtx,
  post: Doc<"posts">,
  at: number,
  pinned: boolean,
) {
  const retry = await needsRecovery(ctx, post);
  if (post.status.kind === "queued")
    await ctx.scheduler.cancel(post.status.jobId);
  const generation = (post.scheduleGeneration ?? 0) + 1;
  const jobId = await ctx.scheduler.runAt(at, internal.posts.fire, {
    id: post._id,
    retry,
    generation,
  });
  await patchPost(ctx, post._id, {
    status: { kind: "queued", at, jobId, generation, retry },
    pinned,
    scheduleGeneration: generation,
  });
}

export async function startPublishing(
  ctx: MutationCtx,
  post: Doc<"posts">,
  at: number,
  retry: boolean,
  attempt = 0,
) {
  const startedAt = Math.max(
    Date.now(),
    (post.lastStartedAt ??
      (post.status.kind === "publishing" ? post.status.startedAt : 0)) + 1,
  );
  await patchPost(ctx, post._id, {
    status: { kind: "publishing", at, startedAt, retry, attempt },
    lastStartedAt: startedAt,
    source: post.source,
  });
  await ctx.scheduler.runAfter(0, internal.publishing.publish, {
    id: post._id,
    startedAt,
    retry,
  });
}

const byTime = (a: Doc<"posts">, b: Doc<"posts">) =>
  (a.status.kind === "draft" ? a._creationTime : a.status.at) -
    (b.status.kind === "draft" ? b._creationTime : b.status.at) ||
  a._creationTime - b._creationTime ||
  a._id.localeCompare(b._id);

export async function compactAfter(ctx: MutationCtx, removedAt: number) {
  const settings = await readSettings(ctx);
  if (settings.gapPolicy !== "autoFill") return;
  const posts = await schedulingPosts(ctx);
  const movable = posts
    .filter(
      (post) =>
        post.status.kind === "queued" &&
        post.pinned === false &&
        post.status.at > removedAt,
    )
    .sort(byTime);
  const selected = new Set(movable.map((post) => post._id));
  const occupied = occupiedTimes(
    posts.filter((post) => !selected.has(post._id)),
  );
  // Preserve the order of slot-placed posts that precede the removed post.
  let after = posts.reduce(
    (after, post) =>
      post.status.kind === "queued" &&
      post.pinned === false &&
      post.status.at <= removedAt
        ? Math.max(after, post.status.at)
        : after,
    Date.now(),
  );
  for (const post of movable) {
    if (post.status.kind !== "queued") continue;
    const at = Math.min(post.status.at, nextSlot(settings, occupied, after));
    if (at !== post.status.at) await place(ctx, post, at, false);
    occupied.add(at);
    after = Math.max(after, at);
  }
}

export async function hold(
  ctx: MutationCtx,
  post: Doc<"posts">,
  reason: string,
) {
  if (post.status.kind === "draft" || post.status.kind === "published") return;
  // Queued posts enter here from their own fire mutation, which is completing.
  if (post.status.kind === "publishing" && post.status.retryJobId)
    await ctx.scheduler.cancel(post.status.retryJobId);
  const at = post.status.at;
  await patchPost(ctx, post._id, {
    status: {
      kind: "held",
      at,
      heldAt: Date.now(),
      reason,
      retry: await needsRecovery(ctx, post),
    },
  });
  await compactAfter(ctx, at);
}

export async function releaseHeld(ctx: MutationCtx) {
  const settings = await readSettings(ctx);
  const posts = await schedulingPosts(ctx);
  const held = posts.filter((post) => post.status.kind === "held").sort(byTime);
  if (!held.length) return;
  const later =
    settings.gapPolicy === "autoFill"
      ? posts
          .filter(
            (post) =>
              post.status.kind === "queued" &&
              post.pinned === false &&
              byTime(post, held[0]) > 0,
          )
          .sort(byTime)
      : [];
  const selected = new Set(later.map((post) => post._id));
  const occupied = occupiedTimes(
    posts.filter((post) => !selected.has(post._id)),
  );
  let after = Date.now();
  for (const post of [...held, ...later]) {
    if (post.status.kind === "draft") continue;
    let at: number;
    if (settings.gapPolicy === "keepTimes") {
      // Preserve the local clock when advancing a held post to a future day.
      at = futureLocalDay(post.status.at, Date.now(), settings.timeZone, 1);
      if (occupied.has(at) || at <= after)
        at = nextSlot(settings, occupied, Math.max(at, after));
    } else {
      at = nextSlot(settings, occupied, after);
    }
    await place(ctx, post, at, post.pinned ?? false);
    occupied.add(at);
    after = at;
  }
}

export function accountState(account: Doc<"account"> | null) {
  return account
    ? {
        threadsUserId: account.threadsUserId,
        username: account.username,
        needsReconnect: account.needsReconnect,
        tokenExpiresAt: account.tokenExpiresAt,
        lastRefreshError: account.lastRefreshError ?? null,
        lastRefreshErrorAt: account.lastRefreshErrorAt ?? null,
      }
    : null;
}
