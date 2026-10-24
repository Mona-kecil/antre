import { v } from "convex/values";
import { z } from "zod";
import { escapeLinkedInText, linkedinTextSchema } from "../src/lib/linkedin";
import { futureLocalDay } from "../src/lib/timezone";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type {
  OwnedMutationCtx as MutationCtx,
  OwnedActionCtx,
  OwnedQueryCtx as QueryCtx,
} from "./access";
import { ownedRow, workspaceContext } from "./access";
import { ownerAction, ownerMutation, ownerQuery } from "./auth";
import { nextSlot, validateSettings, validateTime } from "./lib/scheduling";
import { queueSettings } from "./schema";

type Post = Doc<"linkedinPosts">;
type Settings = Omit<Doc<"linkedinSettings">, "_id" | "_creationTime">;
const postId = { id: v.id("linkedinPosts") };
const UNKNOWN =
  "LinkedIn may have published this post. Check your profile before retrying; another attempt may create a duplicate.";
const defaultSettings = {
  windows: [{ start: "08:00", end: "08:00" }],
  intervalMinutes: 60,
  timeZone: "Asia/Jakarta",
  gapPolicy: "keepTimes",
  topics: [],
  writingInstructions: "",
} satisfies Settings;

function publicAccount(account: Doc<"linkedinAccount"> | null) {
  return (
    account && {
      memberId: account.memberId,
      name: account.name,
      tokenExpiresAt: account.tokenExpiresAt,
      needsReconnect:
        account.needsReconnect || account.tokenExpiresAt <= Date.now(),
    }
  );
}

function content(text: string, topic?: string, notes?: string) {
  const value = linkedinTextSchema.parse(text);
  if (topic && [...topic.trim()].length > 100)
    throw new Error("Use up to 100 characters for a LinkedIn topic");
  if (notes && [...notes.trim()].length > 5000)
    throw new Error("Use up to 5,000 characters for LinkedIn notes");
  return {
    text: value,
    topic: topic?.trim() || undefined,
    notes: notes?.trim() || undefined,
  };
}

async function settingsFor(ctx: QueryCtx): Promise<Settings> {
  const row = await ctx.db
    .query("linkedinSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
    .unique();
  if (!row) {
    const workspace = await ctx.db.get(ctx.workspaceId);
    if (!workspace) throw new Error("Workspace unavailable");
    return { ...defaultSettings, timeZone: workspace.timeZone };
  }
  return {
    windows: row.windows,
    intervalMinutes: row.intervalMinutes,
    timeZone: row.timeZone,
    gapPolicy: row.gapPolicy,
    topics: row.topics,
    writingInstructions: row.writingInstructions,
  };
}

async function active(ctx: QueryCtx) {
  return (
    await Promise.all(
      (["queued", "publishing", "held", "published"] as const).map((kind) =>
        ctx.db
          .query("linkedinPosts")
          .withIndex("workspace_by_kind_at", (q) =>
            q
              .eq("workspaceId", ctx.workspaceId)
              .eq("status.kind", kind)
              .gte("status.at", kind === "published" ? Date.now() : -Infinity),
          )
          .collect(),
      ),
    )
  ).flat();
}

function occupied(posts: Post[]) {
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

function order(a: Post, b: Post) {
  const at = (post: Post) =>
    post.status.kind === "draft" ? post._creationTime : post.status.at;
  return (
    at(a) - at(b) ||
    a._creationTime - b._creationTime ||
    a._id.localeCompare(b._id)
  );
}

async function place(
  ctx: MutationCtx,
  post: Post,
  at: number,
  pinned: boolean,
) {
  if (post.status.kind === "queued")
    await ctx.scheduler.cancel(post.status.jobId);
  const generation = (post.generation ?? 0) + 1;
  const jobId = await ctx.scheduler.runAt(at, internal.linkedin.fire, {
    id: post._id,
    generation,
  });
  await ctx.db.patch(post._id, {
    status: { kind: "queued", at, jobId, generation },
    generation,
    pinned,
  });
}

async function compact(ctx: MutationCtx, removedAt: number) {
  const settings = await settingsFor(ctx);
  if (settings.gapPolicy !== "autoFill") return;
  const posts = await active(ctx);
  const movable = posts
    .filter(
      (post) =>
        post.status.kind === "queued" &&
        post.pinned === false &&
        post.status.at > removedAt,
    )
    .sort(order);
  const selected = new Set(movable.map((post) => post._id));
  const taken = occupied(posts.filter((post) => !selected.has(post._id)));
  let after = posts.reduce(
    (at, post) =>
      post.status.kind === "queued" &&
      post.pinned === false &&
      post.status.at <= removedAt
        ? Math.max(at, post.status.at)
        : at,
    Date.now(),
  );
  for (const post of movable) {
    if (post.status.kind !== "queued") continue;
    const at = Math.min(post.status.at, nextSlot(settings, taken, after));
    if (at !== post.status.at) await place(ctx, post, at, false);
    taken.add(at);
    after = Math.max(after, at);
  }
}

async function releaseAuthHeld(ctx: MutationCtx) {
  const settings = await settingsFor(ctx);
  const posts = await active(ctx);
  const held = posts
    .filter(
      (post) => post.status.kind === "held" && post.status.reason === "auth",
    )
    .sort(order);
  if (!held.length) return;
  const later =
    settings.gapPolicy === "autoFill"
      ? posts
          .filter(
            (post) =>
              post.status.kind === "queued" &&
              post.pinned === false &&
              order(post, held[0]) > 0,
          )
          .sort(order)
      : [];
  const selected = new Set(later.map((post) => post._id));
  const taken = occupied(posts.filter((post) => !selected.has(post._id)));
  let after = Date.now();
  for (const post of [...held, ...later]) {
    if (post.status.kind === "draft") continue;
    let at = nextSlot(settings, taken, after);
    if (settings.gapPolicy === "keepTimes") {
      const original = futureLocalDay(
        post.status.at,
        Date.now(),
        settings.timeZone,
      );
      at =
        original > after && !taken.has(original)
          ? original
          : nextSlot(settings, taken, Math.max(original - 1, after));
    }
    await place(ctx, post, at, post.pinned ?? false);
    taken.add(at);
    after = at;
  }
}

async function holdAuth(
  ctx: MutationCtx,
  post: Post,
  at: number,
  error: string,
) {
  await ctx.db.patch(post._id, {
    status: { kind: "held", at, heldAt: Date.now(), reason: "auth", error },
  });
}

async function beginPublishing(
  base: import("./_generated/server").MutationCtx,
  post: Post,
  at: number,
) {
  if (!post.workspaceId) {
    await base.db.patch(post._id, {
      status: {
        kind: "held",
        at,
        heldAt: Date.now(),
        reason: "auth",
        error: "Unbound workspace",
      },
    });
    console.error("Unbound LinkedIn post", { id: post._id });
    return;
  }
  const workspace = await base.db.get(post.workspaceId);
  if (!workspace || !workspace.ownerId) {
    await base.db.patch(post._id, {
      status: {
        kind: "held",
        at,
        heldAt: Date.now(),
        reason: "auth",
        error: "Unbound workspace",
      },
    });
    console.error("Unbound LinkedIn post", { id: post._id });
    return;
  }
  if (workspace.state !== "active") return;
  const ctx = await workspaceContext(base, post.workspaceId);
  const account = await ctx.db
    .query("linkedinAccount")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
    .unique();
  if (
    !account ||
    account.needsReconnect ||
    account.tokenExpiresAt <= Date.now()
  ) {
    if (account && !account.needsReconnect)
      await ctx.db.patch(account._id, { needsReconnect: true });
    await holdAuth(ctx, post, at, "LinkedIn account needs reconnecting");
    return;
  }
  const startedAt = Math.max(Date.now(), (post.lastStartedAt ?? 0) + 1);
  await ctx.db.patch(post._id, {
    status: { kind: "publishing", at, startedAt },
    lastStartedAt: startedAt,
  });
  await ctx.scheduler.runAfter(0, internal.linkedin.publish, {
    id: post._id,
    startedAt,
  });
}

const connectionArgs = {
  memberId: v.string(),
  name: v.string(),
  accessToken: v.string(),
  tokenExpiresAt: v.number(),
};
export const connect = ownerAction(
  connectionArgs,
  async (ctx: OwnedActionCtx, args): Promise<void> => {
    if (ctx.via !== "user") throw new Error("User session required");
    if (
      !args.accessToken ||
      !Number.isFinite(args.tokenExpiresAt) ||
      args.tokenExpiresAt <= Date.now()
    )
      throw new Error("LinkedIn connection is invalid or expired");
    let profile: { sub: string; name: string };
    try {
      const response = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${args.accessToken}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("Invalid token");
      profile = z
        .object({ sub: z.string().min(1), name: z.string().min(1) })
        .parse(await response.json());
    } catch {
      throw new Error("LinkedIn token could not be verified");
    }
    if (profile.sub !== args.memberId)
      throw new Error("LinkedIn token identity does not match");
    await ctx.runMutation(internal.linkedin.attach, {
      workspaceId: ctx.workspaceId,
      ...args,
      memberId: profile.sub,
      name: profile.name,
    });
  },
);
export const attach = internalMutation({
  args: { ...connectionArgs, workspaceId: v.id("workspaces") },
  handler: async (base, args) => {
    const ctx = await workspaceContext(base, args.workspaceId);
    if (
      !args.memberId.trim() ||
      !args.name.trim() ||
      !args.accessToken ||
      !Number.isFinite(args.tokenExpiresAt) ||
      args.tokenExpiresAt <= Date.now()
    )
      throw new Error("LinkedIn connection is invalid or expired");
    const existingRemote = await ctx.db
      .query("linkedinAccount")
      .withIndex("by_member", (q) => q.eq("memberId", args.memberId))
      .unique();
    if (existingRemote && existingRemote.workspaceId !== ctx.workspaceId)
      throw new Error("Platform account already connected");
    const account = await ctx.db
      .query("linkedinAccount")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
      .unique();
    if (account && account.memberId !== args.memberId)
      throw new Error("Reconnect the same LinkedIn member");
    const value = {
      memberId: args.memberId,
      name: args.name,
      accessToken: args.accessToken,
      tokenExpiresAt: args.tokenExpiresAt,
      needsReconnect: false,
    };
    if (account) await ctx.db.patch(account._id, value);
    else
      await ctx.db.insert("linkedinAccount", {
        ...value,
        workspaceId: ctx.workspaceId,
      });
    await releaseAuthHeld(ctx);
  },
});

export const current = ownerQuery({}, async (ctx: QueryCtx) =>
  publicAccount(
    await ctx.db
      .query("linkedinAccount")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
      .unique(),
  ),
);
export const getSettings = ownerQuery({}, (ctx: QueryCtx) => settingsFor(ctx));
export const updateSettings = ownerMutation(
  {
    ...queueSettings,
    topics: v.optional(v.array(v.string())),
    writingInstructions: v.optional(v.string()),
  },
  async (ctx: MutationCtx, args) => {
    const previous = await settingsFor(ctx);
    const topics =
      args.topics?.map((topic) => topic.trim()).filter(Boolean) ??
      previous.topics;
    const writingInstructions =
      args.writingInstructions?.trim() ?? previous.writingInstructions;
    if (
      topics.length > 100 ||
      topics.some((topic) => [...topic].length > 100) ||
      new Set(topics).size !== topics.length
    )
      throw new Error(
        "Use up to 100 distinct LinkedIn topics, each 1–100 characters",
      );
    if ([...writingInstructions].length > 10000)
      throw new Error(
        "Use up to 10,000 characters for LinkedIn writing instructions",
      );
    const value = {
      ...validateSettings({
        windows: args.windows,
        intervalMinutes: args.intervalMinutes,
        timeZone: args.timeZone,
        gapPolicy: args.gapPolicy,
      }),
      topics,
      writingInstructions,
    };
    const row = await ctx.db
      .query("linkedinSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
      .unique();
    if (row)
      await ctx.db.replace(row._id, { ...value, workspaceId: ctx.workspaceId });
    else
      await ctx.db.insert("linkedinSettings", {
        ...value,
        workspaceId: ctx.workspaceId,
      });
    return value;
  },
);

export const createDraft = ownerMutation(
  {
    text: v.string(),
    topic: v.optional(v.string()),
    notes: v.optional(v.string()),
    source: v.union(v.literal("web"), v.literal("agent")),
  },
  (ctx: MutationCtx, args) =>
    ctx.db.insert("linkedinPosts", {
      workspaceId: ctx.workspaceId,
      ...content(args.text, args.topic, args.notes),
      source: args.source,
      status: { kind: "draft" },
    }),
);
export const updateDraft = ownerMutation(
  {
    ...postId,
    text: v.string(),
    topic: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  async (ctx: MutationCtx, args) => {
    const post = await ownedRow(ctx, args.id);
    if (
      !post ||
      (post.status.kind !== "draft" && post.status.kind !== "failed")
    )
      throw new Error("Only drafts and failed LinkedIn posts can be edited");
    await ctx.db.patch(
      args.id,
      content(args.text, args.topic ?? post.topic, args.notes ?? post.notes),
    );
  },
);

function item(post: Post) {
  return {
    ...post,
    id: post._id,
    at: post.status.kind === "draft" ? null : post.status.at,
    pinned: post.pinned ?? false,
    held: post.status.kind === "held",
    retryAttempt:
      post.status.kind === "held" && post.status.reason === "unknown"
        ? post.status.startedAt
        : null,
  };
}
export const get = ownerQuery(postId, async (ctx: QueryCtx, { id }) => {
  const post = await ctx.db.get(id);
  return post?.workspaceId === ctx.workspaceId ? item(post) : null;
});

const viewFor = (post: Post) =>
  post.status.kind === "draft"
    ? "drafts"
    : post.status.kind === "published"
      ? "published"
      : post.status.kind === "failed"
        ? "failed"
        : "scheduled";
export const list = ownerQuery(
  {
    view: v.union(
      v.literal("drafts"),
      v.literal("scheduled"),
      v.literal("published"),
      v.literal("failed"),
    ),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  async (ctx: QueryCtx, args) => {
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 25;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("Use a nonnegative offset and a limit between 1 and 100");
    const posts = await ctx.db
      .query("linkedinPosts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ctx.workspaceId))
      .collect();
    const counts = { drafts: 0, scheduled: 0, published: 0, failed: 0 };
    for (const post of posts) counts[viewFor(post)]++;
    const selected = posts
      .filter((post) => viewFor(post) === args.view)
      .sort((a, b) => (args.view === "scheduled" ? 1 : -1) * order(a, b));
    const settings = await settingsFor(ctx);
    return {
      items: selected.slice(offset, offset + limit).map(item),
      total: selected.length,
      counts,
      account: publicAccount(
        await ctx.db
          .query("linkedinAccount")
          .withIndex("by_workspace", (q) =>
            q.eq("workspaceId", ctx.workspaceId),
          )
          .unique(),
      ),
      settings,
      nextSlot: nextSlot(settings, occupied(posts), Date.now()),
    };
  },
);

export const queue = ownerMutation(
  { ...postId, at: v.optional(v.number()) },
  async (ctx: MutationCtx, { id, at: requested }) => {
    const post = await ownedRow(ctx, id);
    if (
      !post ||
      (post.status.kind !== "draft" && post.status.kind !== "failed")
    )
      throw new Error("Only drafts and failed LinkedIn posts can be queued");
    const scheduled = await active(ctx);
    if (scheduled.filter((p) => p.status.kind !== "published").length >= 500)
      throw new Error("Queue limit reached");
    const taken = occupied(scheduled);
    const at = requested ?? nextSlot(await settingsFor(ctx), taken, Date.now());
    validateTime(at, taken);
    await place(ctx, post, at, requested !== undefined);
    return at;
  },
);
export const unqueue = ownerMutation(
  postId,
  async (ctx: MutationCtx, { id }) => {
    const post = await ownedRow(ctx, id);
    if (
      !post ||
      (post.status.kind !== "queued" &&
        !(post.status.kind === "held" && post.status.reason === "auth"))
    )
      throw new Error("This LinkedIn post cannot be returned to drafts");
    if (post.status.kind === "queued")
      await ctx.scheduler.cancel(post.status.jobId);
    const at = post.status.at;
    await ctx.db.patch(id, { status: { kind: "draft" } });
    await compact(ctx, at);
  },
);
export const deletePost = ownerMutation(
  postId,
  async (ctx: MutationCtx, { id }) => {
    const post = await ownedRow(ctx, id);
    if (!post) throw new Error("LinkedIn post not found");
    if (post.status.kind === "publishing")
      throw new Error("Cannot delete a publishing LinkedIn post");
    if (post.status.kind === "queued")
      await ctx.scheduler.cancel(post.status.jobId);
    await ctx.db.delete(id);
    if (post.status.kind === "queued") await compact(ctx, post.status.at);
  },
);
export const publishNow = ownerMutation(
  postId,
  async (ctx: MutationCtx, { id }) => {
    const post = await ownedRow(ctx, id);
    if (
      !post ||
      post.status.kind === "publishing" ||
      post.status.kind === "published"
    )
      throw new Error("LinkedIn post cannot be published from this state");
    if (post.status.kind === "held" && post.status.reason === "unknown")
      throw new Error(UNKNOWN);
    if (post.status.kind === "queued")
      await ctx.scheduler.cancel(post.status.jobId);
    await beginPublishing(ctx, post, Date.now());
    if (post.status.kind === "queued") await compact(ctx, post.status.at);
  },
);
export const retry = ownerMutation(
  {
    ...postId,
    confirmDuplicateRisk: v.optional(v.boolean()),
    expectedStartedAt: v.optional(v.number()),
  },
  async (ctx: MutationCtx, { id, confirmDuplicateRisk, expectedStartedAt }) => {
    const post = await ownedRow(ctx, id);
    if (!post || (post.status.kind !== "failed" && post.status.kind !== "held"))
      throw new Error("Only failed or held LinkedIn posts can be retried");
    if (
      post.status.kind === "held" &&
      post.status.reason === "unknown" &&
      (confirmDuplicateRisk !== true ||
        expectedStartedAt !== post.status.startedAt)
    )
      throw new Error(UNKNOWN);
    await beginPublishing(ctx, post, Date.now());
  },
);

export const fire = internalMutation({
  args: { ...postId, generation: v.number() },
  handler: async (ctx, { id, generation }) => {
    const post = await ctx.db.get(id);
    if (
      !post ||
      post.status.kind !== "queued" ||
      post.status.generation !== generation ||
      post.status.at > Date.now()
    )
      return;
    await beginPublishing(ctx, post, post.status.at);
    if (
      post.workspaceId &&
      (await ctx.db.get(post.workspaceId))?.ownerId &&
      (await ctx.db.get(post.workspaceId))?.state === "active" &&
      (await ctx.db.get(id))?.status.kind === "held"
    )
      await compact(
        await workspaceContext(ctx, post.workspaceId),
        post.status.at,
      );
  },
});

export const publishingInput = internalQuery({
  args: postId,
  handler: async (ctx, { id }) => {
    const post = await ctx.db.get(id);
    const workspace = post?.workspaceId && (await ctx.db.get(post.workspaceId));
    const account =
      workspace?.state === "active" && workspace.ownerId
        ? await ctx.db
            .query("linkedinAccount")
            .withIndex("by_workspace", (q) =>
              q.eq("workspaceId", workspace._id),
            )
            .unique()
        : null;
    return { post, account };
  },
});
export const claimDispatch = internalMutation({
  args: { ...postId, startedAt: v.number(), expectedToken: v.string() },
  handler: async (ctx, { id, startedAt, expectedToken }) => {
    const post = await ctx.db.get(id);
    if (
      !post ||
      post.status.kind !== "publishing" ||
      post.status.startedAt !== startedAt ||
      post.status.dispatchedAt !== undefined
    )
      return false;
    const workspace = post.workspaceId && (await ctx.db.get(post.workspaceId));
    const account =
      workspace?.state === "active" && workspace.ownerId
        ? await ctx.db
            .query("linkedinAccount")
            .withIndex("by_workspace", (q) =>
              q.eq("workspaceId", workspace._id),
            )
            .unique()
        : null;
    if (
      !account ||
      account.needsReconnect ||
      !account.accessToken ||
      account.tokenExpiresAt <= Date.now() ||
      account.accessToken !== expectedToken
    ) {
      await ctx.db.patch(id, {
        status: {
          kind: "held",
          at: post.status.at,
          heldAt: Date.now(),
          reason: "auth",
          error: "LinkedIn account needs reconnecting",
        },
      });
      return false;
    }
    await ctx.db.patch(id, {
      status: { ...post.status, dispatchedAt: Date.now() },
    });
    return true;
  },
});
export const complete = internalMutation({
  args: {
    ...postId,
    startedAt: v.number(),
    expectedToken: v.string(),
    result: v.union(
      v.object({ kind: v.literal("published"), urn: v.string() }),
      v.object({ kind: v.literal("failed"), error: v.string() }),
      v.object({ kind: v.literal("auth"), error: v.string() }),
      v.object({ kind: v.literal("unknown"), error: v.string() }),
    ),
  },
  handler: async (ctx, { id, startedAt, expectedToken, result }) => {
    const post = await ctx.db.get(id);
    if (!post) return;
    if (
      post.status.kind !== "publishing" &&
      !(
        result.kind === "published" &&
        post.status.kind === "held" &&
        post.status.reason === "unknown"
      )
    )
      return;
    if (post.status.startedAt !== startedAt) return;
    const at = post.status.at;
    if (result.kind === "published") {
      await ctx.db.patch(id, {
        status: {
          kind: "published",
          at,
          urn: result.urn,
          permalink: `https://www.linkedin.com/feed/update/${result.urn}/`,
        },
      });
    } else if (result.kind === "failed") {
      await ctx.db.patch(id, {
        status: { kind: "failed", at, error: result.error },
      });
    } else if (result.kind === "unknown") {
      await ctx.db.patch(id, {
        status: {
          kind: "held",
          at,
          heldAt: Date.now(),
          reason: "unknown",
          startedAt,
          error: `${result.error} ${UNKNOWN}`,
        },
      });
      if (
        post.workspaceId &&
        (await ctx.db.get(post.workspaceId))?.state === "active"
      )
        await compact(await workspaceContext(ctx, post.workspaceId), at);
    } else {
      const account = await ctx.db
        .query("linkedinAccount")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", post.workspaceId))
        .unique();
      if (account?.accessToken === expectedToken)
        await ctx.db.patch(account._id, { needsReconnect: true });
      await ctx.db.patch(id, {
        status: {
          kind: "held",
          at,
          heldAt: Date.now(),
          reason: "auth",
          error: result.error,
        },
      });
      if (
        post.workspaceId &&
        (await ctx.db.get(post.workspaceId))?.state === "active"
      )
        await compact(await workspaceContext(ctx, post.workspaceId), at);
      if (
        account &&
        account.accessToken !== expectedToken &&
        !account.needsReconnect &&
        account.tokenExpiresAt > Date.now()
      )
        await releaseAuthHeld(await workspaceContext(ctx, post.workspaceId));
    }
  },
});

export const publish = internalAction({
  args: { ...postId, startedAt: v.number() },
  handler: async (ctx, { id, startedAt }): Promise<void> => {
    const { post, account } = await ctx.runQuery(
      internal.linkedin.publishingInput,
      { id },
    );
    if (
      !post ||
      post.status.kind !== "publishing" ||
      post.status.startedAt !== startedAt ||
      post.status.dispatchedAt !== undefined ||
      !account
    )
      return;
    const complete = (
      result:
        | { kind: "published"; urn: string }
        | { kind: "failed" | "auth" | "unknown"; error: string },
    ) =>
      ctx.runMutation(internal.linkedin.complete, {
        id,
        startedAt,
        expectedToken: account.accessToken,
        result,
      });
    if (account.needsReconnect || account.tokenExpiresAt <= Date.now()) {
      await complete({
        kind: "auth",
        error: "LinkedIn account needs reconnecting",
      });
      return;
    }
    const version = process.env.LINKEDIN_API_VERSION ?? "202609";
    if (!/^\d{6}$/.test(version)) {
      await complete({
        kind: "failed",
        error: "LinkedIn API version must use YYYYMM",
      });
      return;
    }
    if (
      !(await ctx.runMutation(internal.linkedin.claimDispatch, {
        id,
        startedAt,
        expectedToken: account.accessToken,
      }))
    )
      return;
    let response: Response;
    try {
      response = await fetch("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          "Content-Type": "application/json",
          "LinkedIn-Version": version,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          author: `urn:li:person:${account.memberId}`,
          commentary: escapeLinkedInText(post.text),
          visibility: "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      await complete({
        kind: "unknown",
        error: "LinkedIn did not return a response.",
      });
      return;
    }
    if (response.status >= 500 || response.status === 408) {
      await complete({
        kind: "unknown",
        error: `LinkedIn HTTP ${response.status}.`,
      });
    } else if (response.status === 201) {
      const urn = response.headers.get("x-restli-id");
      if (urn && /^urn:li:(share|ugcPost):[0-9]+$/.test(urn))
        await complete({ kind: "published", urn });
      else
        await complete({
          kind: "unknown",
          error: "LinkedIn accepted the post without a valid post ID.",
        });
    } else if (response.status >= 200 && response.status < 300) {
      await complete({
        kind: "unknown",
        error: `LinkedIn returned unexpected HTTP ${response.status}.`,
      });
    } else {
      await complete({
        kind: response.status === 401 ? "auth" : "failed",
        error: `LinkedIn rejected this post (HTTP ${response.status}).${response.status === 403 ? " Check the app's publishing access and permissions." : ""}`,
      });
    }
  },
});

export const sweepStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const posts = await ctx.db
      .query("linkedinPosts")
      .withIndex("by_kind_at", (q) => q.eq("status.kind", "publishing"))
      .collect();
    for (const post of posts) {
      const workspace =
        post.workspaceId && (await ctx.db.get(post.workspaceId));
      if (!workspace || workspace.state !== "active" || !workspace.ownerId)
        continue;
      if (
        post.status.kind !== "publishing" ||
        post.status.startedAt > Date.now() - 15 * 60_000
      )
        continue;
      if (post.status.dispatchedAt === undefined)
        await beginPublishing(ctx, post, post.status.at);
      else {
        await ctx.db.patch(post._id, {
          status: {
            kind: "held",
            at: post.status.at,
            heldAt: Date.now(),
            reason: "unknown",
            startedAt: post.status.startedAt,
            error: UNKNOWN,
          },
        });
        await compact(
          await workspaceContext(ctx, post.workspaceId),
          post.status.at,
        );
      }
    }
  },
});
