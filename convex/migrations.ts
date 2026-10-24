import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { tokenHash } from "./access";
import { dimensions, viewOf } from "./lib/postStore";
import { ownedTables as cleanupTables, isOwnedTable } from "./ownership";

const legacyTables = [
  "account",
  "linkedinAccount",
  "settings",
  "linkedinSettings",
  "posts",
  "linkedinPosts",
  "replies",
  "taxonomy",
  "followers",
  "postStats",
] as const;
export const backfill = internalMutation({
  args: { legacyTokenHash: v.optional(v.string()) },
  handler: async (ctx, { legacyTokenHash }) => {
    let workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_legacy", (q) => q.eq("legacy", true))
      .unique();
    if (!workspace) {
      const id = await ctx.db.insert("workspaces", {
        legacy: true,
        state: "active",
        timeZone: "Asia/Jakarta",
      });
      workspace = await ctx.db.get(id);
    }
    if (!workspace) throw new Error("Legacy workspace missing");
    const workspaceId = workspace._id;
    let patched = 0;
    let done = true;
    for (const table of legacyTables) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_workspace", (q) => q.eq("workspaceId", undefined))
        .take(100);
      if (rows.length === 100) done = false;
      for (const row of rows) {
        await ctx.db.patch(row._id, { workspaceId });
        patched++;
      }
    }
    let state = await ctx.db
      .query("workspaceMigrations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    let registered = 0;
    let indexed = 0;
    if (!state || patched > 0) {
      const statsRows = await ctx.db
        .query("postStats")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      const empty = {
        workspaceId,
        counts: { drafts: 0, scheduled: 0, published: 0, failed: 0 },
        publishedFacets: [],
      };
      if (statsRows[0]) await ctx.db.replace(statsRows[0]._id, empty);
      else await ctx.db.insert("postStats", empty);
      for (const duplicate of statsRows.slice(1))
        await ctx.db.delete(duplicate._id);
      if (state) {
        await ctx.db.patch(state._id, { phase: "posts", cursor: null });
        state = { ...state, phase: "posts", cursor: null };
      } else {
        const id = await ctx.db.insert("workspaceMigrations", {
          workspaceId,
          phase: "posts",
          cursor: null,
        });
        state = await ctx.db.get(id);
      }
    }
    if (done && state?.phase === "posts") {
      const page = await ctx.db
        .query("posts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .paginate({ cursor: state.cursor, numItems: 100 });
      const stats = await ctx.db
        .query("postStats")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .unique();
      if (!stats) throw new Error("Migration stats missing");
      const counts = stats.counts;
      const publishedFacets = stats.publishedFacets;
      for (const post of page.page) {
        for (const part of post.parts) {
          if (!part.imageId) continue;
          const storageId = part.imageId;
          const asset = await ctx.db
            .query("assets")
            .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
            .unique();
          if (asset && asset.workspaceId !== workspaceId)
            throw new Error("Legacy asset ownership conflict");
          if (!asset) {
            await ctx.db.insert("assets", { workspaceId, storageId });
            registered++;
          }
        }
        if (
          !post.libraryIndexed ||
          post.rootPublishedId !== post.publishedIds[0]
        ) {
          await ctx.db.patch(post._id, {
            libraryIndexed: true,
            rootPublishedId: post.publishedIds[0],
          });
          indexed++;
        }
        counts[viewOf(post)]++;
        if (post.status.kind !== "published") continue;
        for (const dimension of dimensions) {
          const code = post.meta?.[dimension];
          if (code === undefined) continue;
          const facet = publishedFacets.find(
            (f) => f.dimension === dimension && f.code === code,
          );
          if (facet) facet.count++;
          else publishedFacets.push({ dimension, code, count: 1 });
        }
      }
      await ctx.db.patch(stats._id, { counts, publishedFacets });
      await ctx.db.patch(state._id, {
        cursor: page.continueCursor,
        phase: page.isDone ? "done" : "posts",
      });
      done = page.isDone;
    }
    const hash =
      legacyTokenHash ??
      (process.env.MCP_TOKEN
        ? await tokenHash(process.env.MCP_TOKEN)
        : undefined);
    if (hash !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(hash))
        throw new Error("Invalid credential hash");
      const existing = await ctx.db
        .query("agentGrants")
        .withIndex("by_hash", (q) => q.eq("hash", hash))
        .unique();
      if (existing && existing.workspaceId !== workspaceId)
        throw new Error("Credential ownership conflict");
      if (!existing)
        await ctx.db.insert("agentGrants", {
          workspaceId,
          hash,
          label: "Legacy MCP",
        });
    }
    return { workspaceId, patched, registered, indexed, done };
  },
});
export const bindLegacyOwner = internalMutation({
  args: { subject: v.string() },
  handler: async (ctx, { subject }) => {
    if (!subject.trim()) throw new Error("Verified WorkOS subject required");
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_legacy", (q) => q.eq("legacy", true))
      .unique();
    if (!workspace || workspace.state !== "active")
      throw new Error("Legacy workspace unavailable");
    const migration = await ctx.db
      .query("workspaceMigrations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .unique();
    if (migration?.phase !== "done")
      throw new Error("Complete legacy backfill before binding");
    let user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();
    if (!user) {
      const id = await ctx.db.insert("users", { subject });
      user = await ctx.db.get(id);
    }
    if (!user) throw new Error("User missing");
    if (workspace.ownerId && workspace.ownerId !== user._id)
      throw new Error("Legacy owner already bound");
    const other = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .unique();
    if (other && other._id !== workspace._id) {
      for (const table of cleanupTables) {
        if (
          await ctx.db
            .query(table)
            .withIndex("by_workspace", (q) => q.eq("workspaceId", other._id))
            .first()
        )
          throw new Error("User already owns a non-empty workspace");
      }
      await ctx.db.delete(other._id);
    }
    await ctx.db.patch(workspace._id, { ownerId: user._id });
    return workspace._id;
  },
});
export const inventory = internalQuery({
  args: {},
  handler: async (ctx) => {
    const tables = [];
    for (const table of cleanupTables) {
      const rows = await ctx.db.query(table).collect();
      tables.push({
        table,
        count: rows.length,
        unbound: rows.filter((row) => !row.workspaceId).length,
      });
    }
    const jobs = [];
    for (const post of [
      ...(await ctx.db.query("posts").collect()),
      ...(await ctx.db.query("linkedinPosts").collect()),
    ]) {
      if (post.status.kind === "queued")
        jobs.push({
          postId: post._id,
          jobId: post.status.jobId,
          at: post.status.at,
        });
      if (
        post.status.kind === "publishing" &&
        "retryJobId" in post.status &&
        post.status.retryJobId
      )
        jobs.push({
          postId: post._id,
          jobId: post.status.retryJobId,
          at: post.status.retryAt,
        });
    }
    return { tables, jobs };
  },
});
export const check = internalQuery({
  args: {},
  handler: async (ctx) => {
    const errors: string[] = [];
    for (const table of cleanupTables) {
      for (const row of await ctx.db.query(table).collect()) {
        const workspace =
          row.workspaceId && (await ctx.db.get(row.workspaceId));
        if (!workspace || !workspace.ownerId)
          errors.push(`${table}:${row._id}:unbound`);
        if ("postId" in row) {
          const post = await ctx.db.get(row.postId);
          if (!post || post.workspaceId !== row.workspaceId)
            errors.push(`${table}:${row._id}:parent`);
        }
        if ("parts" in row)
          for (const part of row.parts) {
            if (!part.imageId) continue;
            const storageId = part.imageId;
            const asset = await ctx.db
              .query("assets")
              .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
              .unique();
            if (!asset || asset.workspaceId !== row.workspaceId)
              errors.push(`${table}:${row._id}:asset`);
          }
      }
    }
    return { ready: errors.length === 0, errors };
  },
});

export const inventoryPage = internalQuery({
  args: {
    table: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { table, cursor }) => {
    if (!isOwnedTable(table)) throw new Error("Unknown owned table");
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 100 });
    return {
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      rows: page.page.map((row) => ({
        id: row._id,
        workspaceId: row.workspaceId ?? null,
        ...("status" in row && row.status.kind === "queued"
          ? { jobId: row.status.jobId, at: row.status.at }
          : {}),
      })),
    };
  },
});
export const jobInventory = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.system
      .query("_scheduled_functions")
      .paginate({ cursor, numItems: 100 });
    return {
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      jobs: page.page.map((job) => ({
        id: job._id,
        name: job.name,
        scheduledTime: job.scheduledTime,
        state: job.state.kind,
      })),
    };
  },
});
