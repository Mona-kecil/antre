import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { withSecret } from "./auth";
import { nextSlot, validateSettings, validateTime } from "./lib/scheduling";
import { queueSettings } from "./schema";
import { escapeLinkedInText, linkedinTextSchema } from "../src/lib/linkedin";

type Post = Doc<"linkedinPosts">;
type Settings = Omit<Doc<"linkedinSettings">, "_id" | "_creationTime">;
const postId = { id: v.id("linkedinPosts") };
const DAY = 86_400_000;
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
  const row = await ctx.db.query("linkedinSettings").unique();
  if (!row) return defaultSettings;
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
          .withIndex("by_kind_at", (q) =>
            q
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
      const original =
        post.status.at +
        DAY * Math.max(0, Math.floor((Date.now() - post.status.at) / DAY) + 1);
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

async function beginPublishing(ctx: MutationCtx, post: Post, at: number) {
  const account = await ctx.db.query("linkedinAccount").unique();
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

export const connect = mutation(
  withSecret(
    {
      memberId: v.string(),
      name: v.string(),
      accessToken: v.string(),
      tokenExpiresAt: v.number(),
    },
    async (ctx: MutationCtx, args) => {
      if (
        !args.memberId.trim() ||
        !args.name.trim() ||
        !args.accessToken ||
        !Number.isFinite(args.tokenExpiresAt) ||
        args.tokenExpiresAt <= Date.now()
      )
        throw new Error("LinkedIn connection is invalid or expired");
      const account = await ctx.db.query("linkedinAccount").unique();
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
      else await ctx.db.insert("linkedinAccount", value);
      await releaseAuthHeld(ctx);
    },
  ),
);

export const current = query(
  withSecret({}, async (ctx: QueryCtx) =>
    publicAccount(await ctx.db.query("linkedinAccount").unique()),
  ),
);
export const getSettings = query(
  withSecret({}, (ctx: QueryCtx) => settingsFor(ctx)),
);
export const updateSettings = mutation(
  withSecret(
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
      const row = await ctx.db.query("linkedinSettings").unique();
      if (row) await ctx.db.replace(row._id, value);
      else await ctx.db.insert("linkedinSettings", value);
      return value;
    },
  ),
);

export const createDraft = mutation(
  withSecret(
    {
      text: v.string(),
      topic: v.optional(v.string()),
      notes: v.optional(v.string()),
      source: v.union(v.literal("web"), v.literal("agent")),
    },
    (ctx: MutationCtx, args) =>
      ctx.db.insert("linkedinPosts", {
        ...content(args.text, args.topic, args.notes),
        source: args.source,
        status: { kind: "draft" },
      }),
  ),
);
export const updateDraft = mutation(
  withSecret(
    {
      ...postId,
      text: v.string(),
      topic: v.optional(v.string()),
      notes: v.optional(v.string()),
    },
    async (ctx: MutationCtx, args) => {
      const post = await ctx.db.get(args.id);
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
  ),
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
export const get = query(
  withSecret(postId, async (ctx: QueryCtx, { id }) => {
    const post = await ctx.db.get(id);
    return post ? item(post) : null;
  }),
);

const viewFor = (post: Post) =>
  post.status.kind === "draft"
    ? "drafts"
    : post.status.kind === "published"
      ? "published"
      : post.status.kind === "failed"
        ? "failed"
        : "scheduled";
export const list = query(
  withSecret(
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
        throw new Error(
          "Use a nonnegative offset and a limit between 1 and 100",
        );
      const posts = await ctx.db.query("linkedinPosts").collect();
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
        account: publicAccount(await ctx.db.query("linkedinAccount").unique()),
        settings,
        nextSlot: nextSlot(settings, occupied(posts), Date.now()),
      };
    },
  ),
);

export const queue = mutation(
  withSecret(
    { ...postId, at: v.optional(v.number()) },
    async (ctx: MutationCtx, { id, at: requested }) => {
      const post = await ctx.db.get(id);
      if (
        !post ||
        (post.status.kind !== "draft" && post.status.kind !== "failed")
      )
        throw new Error("Only drafts and failed LinkedIn posts can be queued");
      const taken = occupied(await active(ctx));
      const at =
        requested ?? nextSlot(await settingsFor(ctx), taken, Date.now());
      validateTime(at, taken);
      await place(ctx, post, at, requested !== undefined);
      return at;
    },
  ),
);
export const unqueue = mutation(
  withSecret(postId, async (ctx: MutationCtx, { id }) => {
    const post = await ctx.db.get(id);
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
  }),
);
export const deletePost = mutation(
  withSecret(postId, async (ctx: MutationCtx, { id }) => {
    const post = await ctx.db.get(id);
    if (!post) throw new Error("LinkedIn post not found");
    if (post.status.kind === "publishing")
      throw new Error("Cannot delete a publishing LinkedIn post");
    if (post.status.kind === "queued")
      await ctx.scheduler.cancel(post.status.jobId);
    await ctx.db.delete(id);
    if (post.status.kind === "queued") await compact(ctx, post.status.at);
  }),
);
export const publishNow = mutation(
  withSecret(postId, async (ctx: MutationCtx, { id }) => {
    const post = await ctx.db.get(id);
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
  }),
);
export const retry = mutation(
  withSecret(
    {
      ...postId,
      confirmDuplicateRisk: v.optional(v.boolean()),
      expectedStartedAt: v.optional(v.number()),
    },
    async (
      ctx: MutationCtx,
      { id, confirmDuplicateRisk, expectedStartedAt },
    ) => {
      const post = await ctx.db.get(id);
      if (
        !post ||
        (post.status.kind !== "failed" && post.status.kind !== "held")
      )
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
  ),
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
    if ((await ctx.db.get(id))?.status.kind === "held")
      await compact(ctx, post.status.at);
  },
});

export const publishingInput = internalQuery({
  args: postId,
  handler: async (ctx, { id }) => ({
    post: await ctx.db.get(id),
    account: await ctx.db.query("linkedinAccount").unique(),
  }),
});
export const claimDispatch = internalMutation({
  args: { ...postId, startedAt: v.number() },
  handler: async (ctx, { id, startedAt }) => {
    const post = await ctx.db.get(id);
    if (
      !post ||
      post.status.kind !== "publishing" ||
      post.status.startedAt !== startedAt ||
      post.status.dispatchedAt !== undefined
    )
      return false;
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
      await compact(ctx, at);
    } else {
      const account = await ctx.db.query("linkedinAccount").unique();
      if (account?.accessToken === expectedToken)
        await ctx.db.patch(account._id, { needsReconnect: true });
      await holdAuth(ctx, post, at, result.error);
      await compact(ctx, at);
      if (
        account &&
        account.accessToken !== expectedToken &&
        !account.needsReconnect &&
        account.tokenExpiresAt > Date.now()
      )
        await releaseAuthHeld(ctx);
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
        await compact(ctx, post.status.at);
      }
    }
  },
});
