import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";

class ThreadsError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

async function threads(
  path: string,
  token: string,
  params: Record<string, string> = {},
  method = "GET",
) {
  const url = new URL(`https://graph.threads.net/v1.0/${path}`);
  if (method === "GET") url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(method === "GET" ? {} : { body: new URLSearchParams(params) }),
  });
  const body: unknown = await response.json();
  if (!body || typeof body !== "object")
    throw new Error("Threads returned an invalid response");
  if ("error" in body && body.error && typeof body.error === "object") {
    const error = body.error;
    throw new ThreadsError(
      "message" in error && typeof error.message === "string"
        ? error.message
        : `Threads HTTP ${response.status}`,
      "code" in error && typeof error.code === "number"
        ? error.code
        : undefined,
    );
  }
  if (!response.ok) throw new Error(`Threads HTTP ${response.status}`);
  return body;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Threads response is missing ${field}`);
  return value;
}

export const getPost = internalQuery({
  args: { id: v.id("posts") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const getAccount = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("account").unique(),
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
    await ctx.db.patch(id, { publishedIds: [...post.publishedIds, threadsId] });
    return true;
  },
});

export const complete = internalMutation({
  args: {
    id: v.id("posts"),
    startedAt: v.number(),
    result: v.union(
      v.object({ kind: v.literal("published"), permalink: v.string() }),
      v.object({
        kind: v.literal("failed"),
        error: v.string(),
        needsReconnect: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, { id, startedAt, result }) => {
    if (result.kind === "failed" && result.needsReconnect) {
      const account = await ctx.db.query("account").unique();
      if (account) await ctx.db.patch(account._id, { needsReconnect: true });
    }
    const post = await ctx.db.get(id);
    if (
      !post ||
      post.status.kind !== "publishing" ||
      post.status.startedAt !== startedAt
    )
      return;
    const at = post.status.at;
    await ctx.db.patch(id, {
      status:
        result.kind === "published"
          ? { kind: "published", at, permalink: result.permalink }
          : { kind: "failed", at, error: result.error },
    });
  },
});

export const publish = internalAction({
  args: { id: v.id("posts"), startedAt: v.number(), retry: v.boolean() },
  handler: async (ctx, { id, startedAt, retry }): Promise<void> => {
    const post = await ctx.runQuery(internal.publishing.getPost, { id });
    if (
      !post ||
      post.status.kind !== "publishing" ||
      post.status.startedAt !== startedAt
    )
      return;
    const account = await ctx.runQuery(internal.publishing.getAccount, {});
    try {
      if (
        !account ||
        account.needsReconnect ||
        account.tokenExpiresAt <= Date.now()
      ) {
        throw new Error("Threads account needs reconnecting");
      }
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
          const recent = await threads(
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
          if (previousId) params.reply_to_id = previousId;
          if (part.imageId) {
            const url = await ctx.storage.getUrl(part.imageId);
            if (!url) throw new Error("Post image is missing from storage");
            params.image_url = url;
          }
          const container = await threads(
            `${account.threadsUserId}/threads`,
            account.accessToken,
            params,
            "POST",
          );
          const containerId = requiredString(
            "id" in container ? container.id : undefined,
            "container id",
          );
          const published = await threads(
            `${account.threadsUserId}/threads_publish`,
            account.accessToken,
            { creation_id: containerId },
            "POST",
          );
          threadsId = requiredString(
            "id" in published ? published.id : undefined,
            "published id",
          );
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
      const first = await threads(firstId, account.accessToken, {
        fields: "permalink",
      });
      await ctx.runMutation(internal.publishing.complete, {
        id,
        startedAt,
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
      await ctx.runMutation(internal.publishing.complete, {
        id,
        startedAt,
        result: {
          kind: "failed",
          error: account
            ? message.replaceAll(account.accessToken, "[redacted]")
            : message,
          needsReconnect: error instanceof ThreadsError && error.code === 190,
        },
      });
    }
  },
});

export const saveToken = internalMutation({
  args: {
    token: v.optional(
      v.object({ accessToken: v.string(), tokenExpiresAt: v.number() }),
    ),
  },
  handler: async (ctx, { token }) => {
    const account = await ctx.db.query("account").unique();
    if (account)
      await ctx.db.patch(account._id, {
        ...token,
        needsReconnect: token === undefined,
      });
  },
});

export const refreshToken = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const account = await ctx.runQuery(internal.publishing.getAccount, {});
    if (!account) return;
    try {
      const result = await threads(
        "refresh_access_token",
        account.accessToken,
        { grant_type: "th_refresh_token" },
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
        token: {
          accessToken,
          tokenExpiresAt: Date.now() + result.expires_in * 1000,
        },
      });
    } catch {
      await ctx.runMutation(internal.publishing.saveToken, {});
    }
  },
});

export const sweepStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const post of await ctx.db.query("posts").collect()) {
      if (
        post.status.kind === "publishing" &&
        post.status.startedAt < Date.now() - 10 * 60_000
      ) {
        await ctx.db.patch(post._id, {
          status: {
            kind: "failed",
            at: post.status.at,
            error:
              "Publishing timed out after 10 minutes; retry to check Threads and resume",
          },
        });
      }
    }
  },
});
