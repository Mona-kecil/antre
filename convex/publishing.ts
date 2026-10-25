import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { activeWorkspace, connectionActive, workspaceContext } from "./access";
import { patchPost } from "./lib/postStore";
import { hold, releaseHeld, startPublishing } from "./lib/scheduling";

class ThreadsError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly httpStatus?: number,
    readonly transient = false,
  ) {
    super(message);
  }
}

export async function threads(
  path: string,
  token: string,
  params: Record<string, string> = {},
  method = "GET",
) {
  const apiPath = path.startsWith("/") ? path : `/v1.0/${path}`;
  const url = new URL(`https://graph.threads.net${apiPath}`);
  if (method === "GET") url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(method === "GET" ? {} : { body: new URLSearchParams(params) }),
  }).catch((error: unknown) => {
    throw new ThreadsError(
      error instanceof Error ? error.message : "Threads network request failed",
      undefined,
      undefined,
      true,
    );
  });
  const body: unknown = await response.json().catch(() => {
    throw new ThreadsError(
      `Threads HTTP ${response.status}: invalid response`,
      undefined,
      response.status,
      response.status === 429 || response.status >= 500,
    );
  });
  if (!body || typeof body !== "object")
    throw new ThreadsError(
      "Threads returned an invalid response",
      undefined,
      response.status,
      response.status === 429 || response.status >= 500,
    );
  if ("error" in body && body.error && typeof body.error === "object") {
    const error = body.error;
    throw new ThreadsError(
      "message" in error && typeof error.message === "string"
        ? error.message
        : `Threads HTTP ${response.status}`,
      "code" in error && typeof error.code === "number"
        ? error.code
        : undefined,
      response.status,
      response.status === 429 ||
        response.status >= 500 ||
        ("is_transient" in error && error.is_transient === true) ||
        ("code" in error && [4, 17, 32, 613].includes(Number(error.code))),
    );
  }
  if (!response.ok)
    throw new ThreadsError(
      `Threads HTTP ${response.status}`,
      undefined,
      response.status,
      response.status === 429 || response.status >= 500,
    );
  return body;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Threads response is missing ${field}`);
  return value;
}

export async function publishContainer({
  threadsUserId,
  accessToken,
  params,
  beforeDispatch = async () => {},
}: {
  threadsUserId: string;
  accessToken: string;
  params: Record<string, string>;
  beforeDispatch?: () => Promise<void>;
}): Promise<string> {
  await beforeDispatch();
  const container = await threads(
    `${threadsUserId}/threads`,
    accessToken,
    params,
    "POST",
  );
  const containerId = requiredString(
    "id" in container ? container.id : undefined,
    "container id",
  );
  const deadline = Date.now() + 30_000;
  while (true) {
    await beforeDispatch();
    const result = await threads(containerId, accessToken, {
      fields: "status,error_message",
    });
    const status = "status" in result ? result.status : undefined;
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(
        "error_message" in result &&
          typeof result.error_message === "string" &&
          result.error_message
          ? result.error_message
          : status,
      );
    }
    if (Date.now() >= deadline)
      throw new ThreadsError(
        "Threads is still processing this part; retry shortly",
        undefined,
        undefined,
        true,
      );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  await beforeDispatch();
  const published = await threads(
    `${threadsUserId}/threads_publish`,
    accessToken,
    { creation_id: containerId },
    "POST",
  );
  return requiredString(
    "id" in published ? published.id : undefined,
    "published id",
  );
}

export const getPost = internalQuery({
  args: { id: v.id("posts") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const getAccount = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace || workspace.state !== "active") return null;
    return ctx.db
      .query("account")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
  },
});

export const recordId = internalMutation({
  args: {
    id: v.id("posts"),
    startedAt: v.number(),
    index: v.number(),
    threadsId: v.string(),
  },
  handler: async (ctx, { id, startedAt, index, threadsId }) => {
    const post = await ctx.db.get(id);
    if (
      !post ||
      post.status.kind !== "publishing" ||
      post.status.startedAt !== startedAt ||
      post.publishedIds.length !== index
    )
      return false;
    await patchPost(ctx, id, {
      publishedIds: [...post.publishedIds, threadsId],
    });
    return true;
  },
});

export const complete = internalMutation({
  args: {
    id: v.id("posts"),
    startedAt: v.number(),
    accessToken: v.optional(v.string()),
    result: v.union(
      v.object({ kind: v.literal("published"), permalink: v.string() }),
      v.object({
        kind: v.literal("failed"),
        error: v.string(),
        needsReconnect: v.boolean(),
        retryable: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, { id, startedAt, result, accessToken }) => {
    const post = await ctx.db.get(id);
    if (
      !post ||
      post.status.kind !== "publishing" ||
      post.status.startedAt !== startedAt ||
      post.status.retryAt !== undefined
    )
      return;
    const workspace = await ctx.db.get(post.workspaceId);
    if (!workspace) return;
    if (workspace.state === "deleting" && result.kind === "failed") {
      await ctx.db.patch(id, {
        status: { kind: "failed", at: post.status.at, error: result.error },
      });
      return;
    }
    const at = post.status.at;
    if (result.kind === "published") {
      await patchPost(ctx, id, {
        status: { kind: "published", at, permalink: result.permalink },
      });
      return;
    }
    if (result.needsReconnect) {
      const account = await ctx.db
        .query("account")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", post.workspaceId))
        .unique();
      if (
        account &&
        (accessToken === undefined || account.accessToken === accessToken)
      )
        await ctx.db.patch(account._id, { needsReconnect: true });
      await hold(
        await workspaceContext(ctx, post.workspaceId),
        post,
        result.error,
      );
      // An OAuth reconnect may have completed while this request was in flight.
      const current = await ctx.db
        .query("account")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", post.workspaceId))
        .unique();
      if (
        current &&
        !current.needsReconnect &&
        current.tokenExpiresAt > Date.now()
      )
        await releaseHeld(await workspaceContext(ctx, post.workspaceId));
      return;
    }
    const attempt = post.status.attempt ?? 0;
    const delay = [60_000, 5 * 60_000, 15 * 60_000][attempt];
    if (result.retryable && delay !== undefined) {
      const retryAt = Date.now() + delay;
      const retryJobId = await ctx.scheduler.runAt(
        retryAt,
        internal.posts.retryAutomatic,
        { id, startedAt, attempt: attempt + 1 },
      );
      await patchPost(ctx, id, {
        status: { ...post.status, attempt: attempt + 1, retryAt, retryJobId },
      });
    } else {
      await patchPost(ctx, id, {
        status: { kind: "failed", at, error: result.error },
      });
    }
  },
});

export const publish = internalAction({
  args: { id: v.id("posts"), startedAt: v.number(), retry: v.boolean() },
  handler: async (ctx, { id, startedAt, retry }): Promise<void> => {
    const post = await ctx.runQuery(internal.publishing.getPost, { id });
    if (
      !post ||
      post.status.kind !== "publishing" ||
      post.status.startedAt !== startedAt ||
      post.status.retryAt !== undefined
    )
      return;
    if (!post.workspaceId) return;
    const account = await ctx.runQuery(internal.publishing.getAccount, {
      workspaceId: post.workspaceId,
    });
    try {
      if (
        !account ||
        account.needsReconnect ||
        account.tokenExpiresAt <= Date.now()
      ) {
        throw new ThreadsError("Threads account needs reconnecting", 190);
      }
      const beforeDispatch = async () => {
        const allowed = await ctx.runQuery(internal.publishing.canDispatch, {
          id,
          startedAt,
          expectedToken: account.accessToken,
        });
        if (!allowed)
          throw new ThreadsError("Threads account needs reconnecting", 190);
      };
      const scopedThreads = async (...args: Parameters<typeof threads>) => {
        await beforeDispatch();
        return threads(...args);
      };
      const publishedIds = [...post.publishedIds];
      for (
        let index = publishedIds.length;
        index < post.parts.length;
        index++
      ) {
        const part = post.parts[index];
        const previousId = publishedIds.at(-1);
        let threadsId: string | undefined;
        if (retry) {
          // Replies have their own feed; the user's threads feed only covers root posts.
          const recent = await scopedThreads(
            previousId ? "me/replies" : `${account.threadsUserId}/threads`,
            account.accessToken,
            {
              fields: "id,text,replied_to,timestamp",
              limit: "100",
              since: String(Math.floor(post._creationTime / 1000)),
            },
          );
          if (!("data" in recent) || !Array.isArray(recent.data))
            throw new Error("Threads response is missing recent posts");
          for (const item of recent.data) {
            if (
              !item ||
              typeof item !== "object" ||
              !("text" in item) ||
              item.text !== part.text
            )
              continue;
            const parent: unknown =
              "replied_to" in item ? item.replied_to : undefined;
            if (
              previousId &&
              (!parent ||
                typeof parent !== "object" ||
                !("id" in parent) ||
                parent.id !== previousId)
            )
              continue;
            if (publishedIds.includes("id" in item ? item.id : undefined))
              continue;
            threadsId = requiredString(
              "id" in item ? item.id : undefined,
              "id",
            );
            break;
          }
        }
        if (!threadsId) {
          const params: Record<string, string> = {
            text: part.text,
            media_type: part.imageId ? "IMAGE" : "TEXT",
          };
          if (index === 0 && post.topicTag) params.topic_tag = post.topicTag;
          if (previousId) params.reply_to_id = previousId;
          if (part.imageId) {
            const url = await ctx.runQuery(internal.publishing.imageUrl, {
              id,
              imageId: part.imageId,
            });
            if (!url) throw new Error("Post image is missing from storage");
            params.image_url = url;
          }
          threadsId = await publishContainer({
            threadsUserId: account.threadsUserId,
            accessToken: account.accessToken,
            params,
            beforeDispatch,
          });
        }
        if (
          !(await ctx.runMutation(internal.publishing.recordId, {
            id,
            startedAt,
            index,
            threadsId,
          }))
        )
          return;
        publishedIds.push(threadsId);
      }
      const firstId = publishedIds[0];
      if (!firstId) throw new Error("Post has no published parts");
      const first = await scopedThreads(firstId, account.accessToken, {
        fields: "permalink",
      });
      await ctx.runMutation(internal.publishing.complete, {
        id,
        startedAt,
        accessToken: account?.accessToken,
        result: {
          kind: "published",
          permalink: requiredString(
            "permalink" in first ? first.permalink : undefined,
            "permalink",
          ),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Threads publishing failed";
      const tokenError = error instanceof ThreadsError && error.code === 190;
      let needsReconnect =
        tokenError &&
        (!account ||
          account.needsReconnect ||
          account.tokenExpiresAt <= Date.now());
      if (tokenError && account && !needsReconnect) {
        needsReconnect = !(await ctx.runQuery(internal.publishing.canDispatch, {
          id,
          startedAt,
          expectedToken: account.accessToken,
        }));
      }
      if (tokenError && account && !needsReconnect) {
        try {
          await threads("me", account.accessToken, { fields: "id" });
        } catch (verificationError) {
          needsReconnect =
            verificationError instanceof ThreadsError &&
            verificationError.code === 190;
        }
        needsReconnect ||= account.tokenExpiresAt <= Date.now();
      }
      await ctx.runMutation(internal.publishing.complete, {
        id,
        startedAt,
        accessToken: account?.accessToken,
        result: {
          kind: "failed",
          error: account
            ? message.replaceAll(account.accessToken, "[redacted]")
            : message,
          needsReconnect,
          retryable:
            (error instanceof ThreadsError && error.transient) ||
            (tokenError && !needsReconnect),
        },
      });
    }
  },
});

export const saveToken = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    expectedToken: v.string(),
    token: v.optional(
      v.object({ accessToken: v.string(), tokenExpiresAt: v.number() }),
    ),
    error: v.optional(v.string()),
    invalid: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { workspaceId, expectedToken, token, error, invalid },
  ) => {
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace || workspace.state !== "active") return;
    const account = await ctx.db
      .query("account")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    if (!account || account.accessToken !== expectedToken) return;
    if (token) {
      await ctx.db.patch(account._id, {
        ...token,
        needsReconnect: false,
        lastRefreshError: undefined,
        lastRefreshErrorAt: undefined,
      });
      await releaseHeld(await workspaceContext(ctx, workspaceId));
    } else {
      await ctx.db.patch(account._id, {
        needsReconnect:
          account.needsReconnect ||
          invalid === true ||
          account.tokenExpiresAt <= Date.now(),
        lastRefreshError: error,
        lastRefreshErrorAt: Date.now(),
      });
    }
  },
});

export const refreshToken = internalAction({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<void> => {
    const account = await ctx.runQuery(internal.publishing.getAccount, {
      workspaceId,
    });
    if (!account || !account.accessToken) return;
    // Long-lived tokens last 60 days and cannot refresh during their first day.
    if (account.tokenExpiresAt - Date.now() > 59 * 86_400_000) return;
    try {
      const result = await threads(
        "/refresh_access_token",
        account.accessToken,
        { grant_type: "th_refresh_token", access_token: account.accessToken },
      );
      const accessToken = requiredString(
        "access_token" in result ? result.access_token : undefined,
        "access_token",
      );
      if (
        !("expires_in" in result) ||
        typeof result.expires_in !== "number" ||
        !Number.isFinite(result.expires_in) ||
        result.expires_in <= 0
      ) {
        throw new Error("Threads response is missing token expiry");
      }
      await ctx.runMutation(internal.publishing.saveToken, {
        workspaceId,
        expectedToken: account.accessToken,
        token: {
          accessToken,
          tokenExpiresAt: Date.now() + result.expires_in * 1000,
        },
      });
    } catch (error) {
      let invalid = false;
      if (error instanceof ThreadsError && error.code === 190) {
        try {
          await threads("me", account.accessToken, { fields: "id" });
        } catch (verificationError) {
          invalid =
            verificationError instanceof ThreadsError &&
            verificationError.code === 190;
        }
      }
      await ctx.runMutation(internal.publishing.saveToken, {
        workspaceId,
        expectedToken: account.accessToken,
        error: (error instanceof Error
          ? error.message
          : "Threads refresh failed"
        ).replaceAll(account.accessToken, "[redacted]"),
        invalid,
      });
    }
  },
});

export const sweepStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const post of await ctx.db
      .query("posts")
      .withIndex("by_kind_at", (q) => q.eq("status.kind", "publishing"))
      .collect()) {
      const workspace = await ctx.db.get(post.workspaceId);
      if (!workspace || workspace.state !== "active") continue;
      if (
        post.status.kind === "publishing" &&
        post.status.startedAt < Date.now() - 15 * 60_000
      ) {
        if (post.status.retryAt !== undefined) continue;
        const attempt = post.status.attempt ?? 0;
        if (attempt < 3) {
          await startPublishing(
            await workspaceContext(ctx, post.workspaceId),
            post,
            post.status.at,
            true,
            attempt + 1,
          );
        } else {
          await patchPost(ctx, post._id, {
            status: {
              kind: "failed",
              at: post.status.at,
              error: "Publishing timed out after 15 minutes; retries exhausted",
            },
          });
        }
      }
    }
  },
});

export const canDispatch = internalQuery({
  args: { id: v.id("posts"), startedAt: v.number(), expectedToken: v.string() },
  handler: async (ctx, { id, startedAt, expectedToken }) => {
    const post = await ctx.db.get(id);
    return (
      !!post &&
      post.status.kind === "publishing" &&
      post.status.startedAt === startedAt &&
      post.status.retryAt === undefined &&
      !!(await connectionActive(ctx, post.workspaceId, expectedToken))
    );
  },
});
export const imageUrl = internalQuery({
  args: { id: v.id("posts"), imageId: v.id("_storage") },
  handler: async (ctx, { id, imageId }) => {
    const post = await ctx.db.get(id);
    if (!post || !post.parts.some((part) => part.imageId === imageId))
      throw new Error("Image not found");
    await activeWorkspace(ctx, post.workspaceId);
    const asset = await ctx.db
      .query("assets")
      .withIndex("by_storageId", (q) => q.eq("storageId", imageId))
      .unique();
    if (!asset || asset.workspaceId !== post.workspaceId)
      throw new Error("Image not found");
    return ctx.storage.getUrl(imageId);
  },
});
