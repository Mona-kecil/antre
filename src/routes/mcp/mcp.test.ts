import { convexTest } from "convex-test";
import type { Doc } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import schema from "../../../convex/schema";
import { storeTestImage } from "../../../convex/testing/storage";
import { expect, test, vi } from "vitest";
import {
  PROTOCOL_VERSION_META_KEY,
  CLIENT_CAPABILITIES_META_KEY,
} from "@modelcontextprotocol/server";
import { POST } from "./+server";

const bridge = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  action: vi.fn(),
}));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: "test-secret" }),
}));
const modules = import.meta.glob([
  "../../../convex/**/*.ts",
  "!../../../convex/**/*.test.ts",
]);

vi.mock("$app/env/private", () => ({ MCP_TOKEN: "test-mcp-token" }));

async function invokeTool(name: string, args: unknown) {
  const response = await POST({
    request: new Request("https://antre.example/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        Authorization: "Bearer test-mcp-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
            [CLIENT_CAPABILITIES_META_KEY]: {},
          },
        },
      }),
    }),
  } as Parameters<typeof POST>[0]);
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return JSON.parse(
    text.startsWith("event:") ? text.split("data: ")[1].trim() : text,
  );
}

test("MCP uploads base64 to Convex storage, attaches the image, and rejects invalid inputs before upload", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const upload = vi.fn(async (input: string, init: RequestInit) => {
    expect(input).toMatch(/^https?:\/\//);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("image/png");
    expect(init.body).toBeInstanceOf(Blob);
    if (!(init.body instanceof Blob)) throw new Error("Expected image blob");
    expect(Buffer.from(await init.body.arrayBuffer()).toString("base64")).toBe(
      png,
    );
    const image = init.body;
    return Response.json({
      storageId: await t.run((ctx) => storeTestImage(ctx, image)),
    });
  });
  vi.stubGlobal("fetch", upload);
  try {
    const response = await invokeTool("upload_image", {
      base64: png,
      contentType: "image/png",
    });
    expect(response.result.isError).not.toBe(true);
    const image = JSON.parse(response.result.content[0].text);
    expect(image).toEqual({
      imageId: expect.any(String),
      previewUrl: expect.stringMatching(/^https?:\/\//),
    });
    const draftResponse = await invokeTool("create_draft", {
      parts: [{ text: "Attached PNG", imageId: image.imageId }],
    });
    expect(draftResponse.result.isError).not.toBe(true);
    const { id } = JSON.parse(draftResponse.result.content[0].text);
    expect(
      await t.query(api.library.searchPosts, {
        secret: "test-secret",
        fullParts: true,
      }),
    ).toMatchObject([
      { id, parts: [{ imageId: image.imageId, imageUrl: image.previewUrl }] },
    ]);
    for (const args of [
      { base64: png, contentType: "image/svg+xml" },
      { base64: png, contentType: "image/webp" },
      { base64: "not base64!", contentType: "image/png" },
      { base64: png },
      {
        url: "https://example.com/image.png",
        base64: png,
        contentType: "image/png",
      },
      { url: "https://example.com/image.png", contentType: "image/png" },
      { url: "file:///tmp/image.png" },
      { url: "http://127.0.0.1/image.png" },
      { url: "http://[::1]/image.png" },
      { url: "http://169.254.169.254/image.png" },
      {},
    ]) {
      const invalid = await invokeTool("upload_image", args);
      expect(invalid.result.isError, JSON.stringify(invalid)).toBe(true);
    }
    expect(upload).toHaveBeenCalledTimes(1);
    const direct = await invokeTool("image_upload_url", {});
    expect(direct.result.isError).not.toBe(true);
    const info = JSON.parse(direct.result.content[0].text);
    expect(info.uploadUrl).toMatch(/^https?:\/\//);
    expect(info.curl).toBe(
      `curl -X POST -H 'Content-Type: image/png' --data-binary @file.png '${info.uploadUrl}'`,
    );
    expect(info.response.storageId).toContain("imageId");
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});

test("MCP creates, changes, batches and clears public topic tags independently of taxonomy", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  try {
    const created = await invokeTool("create_draft", {
      parts: [{ text: "Public topic via MCP" }],
      meta: { topic: "T15" },
    });
    expect(created.result.isError).not.toBe(true);
    const { id } = JSON.parse(created.result.content[0].text);
    const read = async () => {
      const response = await invokeTool("get_posts", { ids: [id] });
      expect(response.result.isError).not.toBe(true);
      return JSON.parse(response.result.content[0].text)[0];
    };
    expect(await read()).toMatchObject({
      topicTag: "Marketing",
      meta: { topic: "T15" },
    });
    const edited = await invokeTool("update_draft", {
      id,
      topicTag: "  Ecommerce  ",
    });
    expect(edited.result.isError).not.toBe(true);
    expect((await read()).topicTag).toBe("Ecommerce");
    await invokeTool("update_draft", { id, parts: [{ text: "Edited text" }] });
    expect((await read()).topicTag).toBe("Ecommerce");
    const queued = await invokeTool("queue", { id });
    expect(queued.result.isError).not.toBe(true);
    const originalAt = (await read()).at;
    const set = await invokeTool("set_topic_tag", {
      ids: [id],
      topicTag: "Marketing",
    });
    expect(set.result.isError).not.toBe(true);
    expect(JSON.parse(set.result.content[0].text)).toEqual({ updated: 1 });
    expect(await read()).toMatchObject({
      topicTag: "Marketing",
      at: originalAt,
      meta: { topic: "T15" },
    });
    const cleared = await invokeTool("set_topic_tag", {
      ids: [id],
      topicTag: "",
    });
    expect(cleared.result.isError).not.toBe(true);
    expect((await read()).topicTag).toBeUndefined();
    for (const topicTag of ["A&B", "Meta.ads", "a".repeat(51)]) {
      const invalid = await invokeTool("set_topic_tag", {
        ids: [id],
        topicTag,
      });
      expect(invalid.result.isError).toBe(true);
    }
    const noTag = await invokeTool("create_draft", {
      parts: [{ text: "No tag" }],
      topicTag: "",
    });
    expect(noTag.result.isError).not.toBe(true);
    const { id: noTagId } = JSON.parse(noTag.result.content[0].text);
    const result = await t.query(api.posts.getPosts, {
      secret: "test-secret",
      ids: [noTagId],
    });
    expect(result.posts[0]?.topicTag).toBeUndefined();
  } finally {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});

test("MCP rejects missing or wrong bearer tokens, then initializes and lists annotated board, schedule and lookup tools", async () => {
  const call = (method: string, token?: string) =>
    POST({
      request: new Request("https://antre.example/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Mcp-Method": method,
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version":
            method === "initialize" ? "2025-11-25" : "2026-07-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          ...(method === "initialize"
            ? {
                params: {
                  protocolVersion: "2025-11-25",
                  capabilities: {},
                  clientInfo: { name: "test", version: "1" },
                },
              }
            : {
                params: {
                  _meta: {
                    [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
                    [CLIENT_CAPABILITIES_META_KEY]: {},
                  },
                },
              }),
        }),
      }),
    } as Parameters<typeof POST>[0]);
  expect((await call("tools/list")).status).toBe(401);
  expect((await call("tools/list", "wrong")).status).toBe(401);
  const init = await call("initialize", "test-mcp-token");
  expect(init.status).toBe(200);
  expect(await init.text()).toContain("antre");
  const list = await call("tools/list", "test-mcp-token");
  expect(list.status).toBe(200);
  const text = await list.text();
  const body = JSON.parse(
    text.startsWith("event:") ? text.split("data: ")[1].trim() : text,
  );
  expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
    "upload_image",
    "image_upload_url",
    "schedule",
    "list_posts",
    "get_posts",
    "create_draft",
    "update_draft",
    "set_topic_tag",
    "queue",
    "reschedule",
    "swap",
    "get_settings",
    "update_settings",
    "unqueue",
    "publish_now",
    "delete_post",
    "taxonomy",
    "set_taxonomy",
    "tag_posts",
    "search_posts",
    "insights",
    "list_replies",
    "draft_reply",
    "send_reply",
    "discard_reply_draft",
    "hide_reply",
    "sync_now",
    "list_linkedin_posts",
    "get_linkedin_post",
    "create_linkedin_draft",
    "update_linkedin_draft",
    "queue_linkedin_post",
    "unqueue_linkedin_post",
    "delete_linkedin_post",
    "publish_linkedin_post",
    "retry_linkedin_post",
    "get_linkedin_settings",
    "set_linkedin_settings",
  ]);
  for (const tool of body.result.tools) {
    expect(tool.annotations, tool.name).toBeDefined();
    if (
      [
        "schedule",
        "list_posts",
        "get_posts",
        "get_settings",
        "taxonomy",
        "search_posts",
        "insights",
        "list_replies",
        "list_linkedin_posts",
        "get_linkedin_post",
        "get_linkedin_settings",
      ].includes(tool.name)
    )
      expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
    if (
      [
        "update_settings",
        "publish_now",
        "delete_post",
        "discard_reply_draft",
        "send_reply",
        "hide_reply",
        "sync_now",
        "queue_linkedin_post",
        "delete_linkedin_post",
        "publish_linkedin_post",
        "retry_linkedin_post",
        "set_linkedin_settings",
      ].includes(tool.name)
    )
      expect(tool.annotations.destructiveHint, tool.name).toBe(true);
    if (
      [
        "upload_image",
        "publish_now",
        "send_reply",
        "hide_reply",
        "sync_now",
        "queue_linkedin_post",
        "publish_linkedin_post",
        "retry_linkedin_post",
      ].includes(tool.name)
    )
      expect(tool.annotations.openWorldHint, tool.name).toBe(true);
  }
  const send = body.result.tools.find(
    (tool: { name: string }) => tool.name === "send_reply",
  );
  expect(Object.keys(send.inputSchema.properties)).toEqual(["replyId", "text"]);
  expect(send.inputSchema.required).toEqual(["replyId", "text"]);
  expect(send.inputSchema.properties.text.description).toBe(
    "the exact draft text the human saw and approved; must match the stored draft",
  );
  expect(send.description).toContain("explicitly told you to send it");
  const retry = body.result.tools.find(
    (tool: { name: string }) => tool.name === "retry_linkedin_post",
  );
  expect(retry.inputSchema.required).toEqual(["id"]);
  expect(
    retry.inputSchema.properties.confirmDuplicateRisk.description,
  ).toContain("explicitly acknowledges");
  expect(retry.description).toContain("Never infer");
  expect(retry.inputSchema.properties.expectedStartedAt.type).toBe("number");
  expect(retry.inputSchema.properties.expectedStartedAt.description).toContain(
    "unchanged numeric retryAttempt",
  );
  const createLinkedin = body.result.tools.find(
    (tool: { name: string }) => tool.name === "create_linkedin_draft",
  );
  expect(Object.keys(createLinkedin.inputSchema.properties)).toEqual([
    "text",
    "topic",
    "notes",
  ]);
  expect(createLinkedin.inputSchema.additionalProperties).toBe(false);
});

test("MCP tags and searches published posts through Convex", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  try {
    const id = await t.run((ctx) =>
      ctx.db.insert("posts", {
        parts: [{ text: "Creative library post" }],
        publishedIds: ["live"],
        source: "threads",
        status: {
          kind: "published",
          at: Date.parse("2026-10-18T00:00:00Z"),
          permalink: "https://threads.net/live",
        },
        meta: { notes: "preserved" },
      }),
    );
    const call = async (name: string, args: unknown) => {
      const body = await invokeTool(name, args);
      expect(body.result.isError).not.toBe(true);
      return JSON.parse(body.result.content[0].text);
    };
    expect(
      await call("set_taxonomy", {
        entries: [
          { dimension: "topic", code: "MY-CODE", name: "Creative testing" },
        ],
      }),
    ).toEqual({ updated: 1 });
    expect(
      await call("tag_posts", {
        posts: [{ id, meta: { topic: "MY-CODE", hook: "A hook" } }],
      }),
    ).toEqual({ updated: 1 });
    expect(
      await call("search_posts", {
        status: "published",
        topic: "MY-CODE",
        text: "creative",
        since: "2026-10-18",
        until: "2026-10-18",
      }),
    ).toMatchObject([
      {
        id,
        text: "Creative library post",
        meta: { topic: "MY-CODE", hook: "A hook", notes: "preserved" },
        permalink: "https://threads.net/live",
      },
    ]);
    await t.run(async (ctx) => {
      await ctx.db.insert("account", {
        threadsUserId: "owner",
        username: "owner",
        accessToken: "test-token",
        tokenExpiresAt: Date.now() + 86_400_000,
        needsReconnect: false,
        repliesSyncedAt: Date.parse("2026-10-18T01:00:00Z"),
      });
      await ctx.db.insert("replies", {
        threadsId: "reader-reply",
        postId: id,
        text: "Reader question",
        username: "reader",
        at: Date.parse("2026-10-18T00:30:00Z"),
        repliedToId: "live",
        mine: false,
        hidden: false,
      });
    });
    expect(await call("list_replies", {})).toEqual({
      account: {
        threadsUserId: "owner",
        username: "owner",
        needsReconnect: false,
        tokenExpiresAt: { iso: expect.any(String), wib: expect.any(String) },
        lastRefreshError: null,
        lastRefreshErrorAt: null,
      },
      total: 1,
      syncedAt: "2026-10-18T01:00:00.000Z",
      replies: [
        {
          replyId: "reader-reply",
          username: "reader",
          text: "Reader question",
          at: "2026-10-18T00:30:00.000Z",
          permalink: null,
          hidden: false,
          draft: null,
          sending: null,
          parentText: "Creative library post",
          postId: id,
          postText: "Creative library post",
        },
      ],
    });
    expect(
      await call("list_replies", { postId: id, unanswered: false, limit: 1 }),
    ).toMatchObject({ replies: [{ replyId: "reader-reply" }] });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await call("list_replies", { drafted: true })).toMatchObject({
      replies: [],
    });
    await call("draft_reply", {
      replyId: "reader-reply",
      text: "Reviewed answer",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await call("list_replies", { drafted: true })).toMatchObject({
      replies: [{ replyId: "reader-reply", draft: "Reviewed answer" }],
    });
    await call("discard_reply_draft", { replyId: "reader-reply" });
    expect(await call("list_replies", { drafted: true })).toMatchObject({
      replies: [],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await t.query(api.library.searchPosts, {
        secret: "test-secret",
        topic: "MY-CODE",
      }),
    ).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});

test("MCP reschedule, swap, and settings operate on the same Convex queue", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T22:45:00Z"));
  const t = convexTest(schema, modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  const secret = "test-secret";
  const call = async (name: string, args: unknown) => {
    const body = await invokeTool(name, args);
    expect(body.result.isError, JSON.stringify(body)).not.toBe(true);
    return JSON.parse(body.result.content[0].text);
  };
  try {
    expect(await call("get_settings", {})).toMatchObject({
      gapPolicy: "keepTimes",
    });
    const settings = {
      windows: [
        { start: "06:00", end: "07:00" },
        { start: "13:00", end: "14:00" },
      ],
      intervalMinutes: 30,
      timeZone: "Asia/Jakarta",
      gapPolicy: "autoFill",
    };
    expect(await call("update_settings", settings)).toEqual(settings);
    const first = await call("create_draft", { parts: [{ text: "first" }] });
    const second = await call("create_draft", { parts: [{ text: "second" }] });
    await call("queue", { id: first.id });
    await call("queue", { id: second.id, at: "2026-10-19T07:00:00+07:00" });
    expect(
      await call("reschedule", {
        id: first.id,
        at: "2026-10-19T13:00:00+07:00",
      }),
    ).toMatchObject({ at: { iso: "2026-10-19T06:00:00.000Z" } });
    await call("reschedule", { id: first.id });
    await call("swap", { id: first.id, otherId: second.id });
    const queued = await t.query(api.posts.listQueue, { secret });
    expect(queued.find(({ _id }) => _id === first.id)).toMatchObject({
      pinned: true,
      at: Date.parse("2026-10-19T07:00:00+07:00"),
    });
    expect(queued.find(({ _id }) => _id === second.id)).toMatchObject({
      pinned: false,
      at: Date.parse("2026-10-19T06:00:00+07:00"),
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(second.id, {
        status: {
          kind: "held",
          at: Date.now(),
          heldAt: Date.now(),
          reason: "Reconnect",
        },
      });
    });
    expect(await call("get_posts", { ids: [second.id] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: second.id,
          held: true,
          pinned: false,
          status: expect.objectContaining({
            kind: "held",
            reason: "Reconnect",
          }),
        }),
      ]),
    );
    const invalid = await invokeTool("update_settings", {
      ...settings,
      windows: [{ start: "13:00", end: "06:00" }],
    });
    expect(invalid.result.isError).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.clearAllMocks();
  }
});

test("MCP schedule excludes past and occupied slots, keeps held and failed slots free, and bounds history reads across WIB days", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  vi.spyOn(Date, "now").mockReturnValue(
    Date.parse("2026-10-19T06:15:00+07:00"),
  );
  const t = convexTest({
    schema,
    modules,
    transactionLimits: { documentsRead: 40 },
  });
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  const secret = "test-secret";
  const at = (time: string) => Date.parse(`2026-10-19T${time}:00+07:00`);
  const call = async (args: unknown) => {
    const body = await invokeTool("schedule", args);
    expect(body.result.isError, JSON.stringify(body)).not.toBe(true);
    return JSON.parse(body.result.content[0].text);
  };
  try {
    await t.mutation(api.posts.updateSettings, {
      secret,
      windows: [
        { start: "06:00", end: "08:00" },
        { start: "13:00", end: "13:30" },
      ],
      intervalMinutes: 30,
      timeZone: "Asia/Jakarta",
      gapPolicy: "keepTimes",
    });
    const imageId = await t.run((ctx) =>
      storeTestImage(ctx, new Blob(["png"], { type: "image/png" })),
    );
    const queued = await t.mutation(api.posts.createDraft, {
      secret,
      source: "agent",
      parts: [{ text: "Queued", imageId }, { text: "Full second part" }],
      meta: { topic: "T1" },
    });
    await t.mutation(api.posts.queue, { secret, id: queued, at: at("06:30") });
    await t.run(async (ctx) => {
      await ctx.db.insert("account", {
        threadsUserId: "owner",
        username: "owner",
        accessToken: "never-return-this-token",
        tokenExpiresAt: Date.now() + 86_400_000,
        needsReconnect: true,
      });
      // Either an unbounded draft or history read exceeds the query's budget.
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("posts", {
          source: "web",
          parts: [{ text: "Unrelated draft" }],
          publishedIds: [],
          status: { kind: "draft" },
        });
        await ctx.db.insert("posts", {
          source: "threads",
          parts: [{ text: "Old history" }],
          publishedIds: [],
          status: {
            kind: "published",
            at: 1000 + i,
            permalink: "https://threads.net/old",
          },
        });
      }
      for (const status of [
        { kind: "failed", at: at("13:00"), error: "Failed" },
        {
          kind: "held",
          at: at("08:00"),
          heldAt: Date.now(),
          reason: "Reconnect",
        },
        {
          kind: "published",
          at: at("07:30"),
          permalink: "https://threads.net/live",
        },
        { kind: "publishing", at: at("07:00"), startedAt: Date.now() },
        {
          kind: "published",
          at: at("06:00") + 86_400_000,
          permalink: "https://threads.net/tomorrow",
        },
      ] satisfies Doc<"posts">["status"][]) {
        await ctx.db.insert("posts", {
          source: "web",
          parts: [{ text: status.kind }],
          publishedIds: [],
          status,
        });
      }
    });
    const plan = await call({ day: "2026-10-19" });
    expect(Object.keys(plan)).toEqual([
      "settings",
      "account",
      "held",
      "nextSlot",
      "days",
    ]);
    expect(plan).toMatchObject({
      held: 1,
      nextSlot: at("08:00"),
      settings: { intervalMinutes: 30 },
      account: { threadsUserId: "owner", needsReconnect: true },
      days: [
        {
          day: "2026-10-19",
          posts: [
            {
              id: queued,
              status: { kind: "queued" },
              pinned: true,
              meta: { topic: "T1" },
              parts: [
                { imageId, imageUrl: expect.stringMatching(/^https?:\/\//) },
                { text: "Full second part" },
              ],
            },
            { status: { kind: "publishing" } },
            { status: { kind: "published" } },
            { status: { kind: "held" } },
            { status: { kind: "failed" } },
          ],
          freeSlots: [at("08:00"), at("13:00"), at("13:30")],
        },
      ],
    });
    expect(JSON.stringify(plan)).not.toContain("accessToken");
    expect(JSON.stringify(plan)).not.toContain("never-return-this-token");
    expect(await call({})).toEqual(plan);
    const range = await call({ day: "2026-10-19", days: 2 });
    expect(range.days).toHaveLength(2);
    expect(range.days[0]).toEqual(plan.days[0]);
    expect(range.days[1]).toMatchObject({
      day: "2026-10-20",
      posts: [{ status: { kind: "published" } }],
      freeSlots: ["06:30", "07:00", "07:30", "08:00", "13:00", "13:30"].map(
        (time) => at(time) + 86_400_000,
      ),
    });
    expect(
      bridge.query.mock.calls.every(([, args]) => args.day === undefined),
    ).toBe(true);
    for (const args of [
      { days: 0 },
      { days: 15 },
      { days: 1.5 },
      { day: "2026-02-30" },
    ])
      expect((await invokeTool("schedule", args)).result.isError).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  }
});

test("MCP board paging preserves counts, facets, previews and validation, while id lookup preserves order and missing posts", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  const secret = "test-secret";
  const call = async (name: string, args: unknown) => {
    const body = await invokeTool(name, args);
    expect(body.result.isError, JSON.stringify(body)).not.toBe(true);
    return JSON.parse(body.result.content[0].text);
  };
  try {
    const imageId = await t.run((ctx) =>
      storeTestImage(ctx, new Blob(["png"], { type: "image/png" })),
    );
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await call("create_draft", {
        parts: [{ text: `Draft ${i}`, imageId }, { text: "Second part" }],
        meta: { topic: "T1", angle: "A1", format: "F1" },
      });
      ids.push(id);
    }
    const missing = await t.mutation(api.posts.createDraft, {
      secret,
      source: "web",
      parts: [{ text: "Deleted" }],
    });
    await t.mutation(api.posts.deletePost, { secret, id: missing });
    const published = await t.run((ctx) =>
      ctx.db.insert("posts", {
        source: "threads",
        parts: [{ text: "Published", imageId }],
        publishedIds: ["live"],
        status: {
          kind: "published",
          at: 1000,
          permalink: "https://threads.net/live",
        },
        metrics: {
          views: 100,
          likes: 10,
          replies: 0,
          reposts: 0,
          quotes: 0,
          shares: 0,
          syncedAt: 2000,
        },
      }),
    );
    const all = await call("list_posts", { view: "drafts" });
    expect(all).toMatchObject({
      counts: { drafts: 3, scheduled: 0, published: 1, failed: 0 },
      total: 3,
      facets: { topic: { T1: 3 }, angle: { A1: 3 }, format: { F1: 3 } },
    });
    const page = await call("list_posts", {
      view: "drafts",
      offset: 1,
      limit: 1,
      topic: "T1",
      angle: "A1",
      format: "F1",
      text: "draft",
      sort: "date",
    });
    expect(page.items).toEqual(all.items.slice(1, 2));
    expect(page.total).toBe(3);
    expect(page.items[0].parts).toEqual([
      {
        text: expect.stringMatching(/^Draft/),
        imageId,
        imageUrl: expect.stringMatching(/^https?:\/\//),
      },
      { text: "Second part" },
    ]);
    expect(
      await call("list_posts", { view: "drafts", offset: 3, limit: 1 }),
    ).toMatchObject({ total: 3, items: [] });
    for (const [args, message] of [
      [{ offset: -1 }, "Offset must be a nonnegative integer"],
      [{ limit: 101 }, "Limit must be an integer between 1 and 100"],
      [
        { sort: "views" },
        "Views and engagement sorting require the published view",
      ],
    ] as const) {
      const invalid = await invokeTool("list_posts", {
        view: "drafts",
        ...args,
      });
      expect(invalid.result.isError).toBe(true);
      expect(invalid.result.content[0].text).toContain(message);
    }
    const lookup = await call("get_posts", {
      ids: [ids[2], missing, published, ids[0], ids[2], "unknown"],
    });
    expect(lookup).toMatchObject([
      {
        id: ids[2],
        held: false,
        pinned: false,
        at: null,
        status: { kind: "draft" },
      },
      null,
      {
        id: published,
        permalink: "https://threads.net/live",
        metrics: { views: 100 },
      },
      { id: ids[0], meta: { topic: "T1" } },
      { id: ids[2] },
      null,
    ]);
    expect(lookup[0].parts).toEqual(
      all.items.find((post: { id: string }) => post.id === ids[2]).parts,
    );
    await expect(
      t.query(api.posts.getPosts, { secret: "wrong", ids }),
    ).rejects.toThrow("Unauthorized");
    for (const ids of [[], Array.from({ length: 51 }, () => published)])
      expect((await invokeTool("get_posts", { ids })).result.isError).toBe(
        true,
      );
  } finally {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});

test("LinkedIn MCP drafts, labels, queue and settings use the separate Convex board", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T05:45:00+07:00"));
  const t = convexTest(schema, modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  const secret = "test-secret";
  const call = async (name: string, args: unknown) => {
    const body = await invokeTool(name, args);
    expect(body.result.isError, JSON.stringify(body)).not.toBe(true);
    return JSON.parse(body.result.content[0].text);
  };
  try {
    await t.mutation(api.linkedin.connect, {
      secret,
      memberId: "linkedin-member",
      name: "LinkedIn Owner",
      accessToken: "never-return-linkedin-token",
      tokenExpiresAt: Date.now() + 86_400_000,
    });
    const threads = await t.mutation(api.posts.createDraft, {
      secret,
      source: "web",
      parts: [{ text: "Threads content" }],
      meta: { topic: "THREADS-TOPIC" },
    });
    const threadsAt = await t.mutation(api.posts.queue, {
      secret,
      id: threads,
    });
    const settings = {
      windows: [{ start: "06:00", end: "09:00" }],
      intervalMinutes: 60,
      timeZone: "Asia/Jakarta",
      gapPolicy: "keepTimes",
      topics: ["Engineering", "Writing"],
      writingInstructions: "Describe shipped systems with concrete examples.",
    };
    expect(await call("get_linkedin_settings", {})).toMatchObject({
      intervalMinutes: 60,
      topics: [],
      writingInstructions: "",
    });
    expect(await call("set_linkedin_settings", settings)).toEqual(settings);
    const {
      topics: _topics,
      writingInstructions: _instructions,
      ...queueSettings
    } = settings;
    expect(await call("set_linkedin_settings", queueSettings)).toEqual(
      settings,
    );
    expect(await t.query(api.posts.getSettings, { secret })).toMatchObject({
      intervalMinutes: 30,
    });

    const first = await call("create_linkedin_draft", {
      text: " A lesson from shipping ",
      topic: "Engineering",
      notes: "Keep the example",
    });
    const second = await call("create_linkedin_draft", {
      text: "🪵".repeat(3000),
    });
    expect(await call("get_linkedin_post", { id: first.id })).toMatchObject({
      text: "A lesson from shipping",
      topic: "Engineering",
      notes: "Keep the example",
      source: "agent",
      status: { kind: "draft" },
    });
    await call("update_linkedin_draft", {
      id: first.id,
      text: "A revised lesson",
    });
    const edited = await call("get_linkedin_post", { id: first.id });
    expect(edited.text).toBe("A revised lesson");
    expect(edited).not.toHaveProperty("topic");
    expect(edited).not.toHaveProperty("notes");
    const board = await call("list_linkedin_posts", {
      view: "drafts",
      offset: 1,
      limit: 1,
    });
    expect(board).toMatchObject({
      total: 2,
      counts: { drafts: 2, scheduled: 0, published: 0, failed: 0 },
      account: { memberId: "linkedin-member", name: "LinkedIn Owner" },
      settings,
    });
    expect(board.items).toHaveLength(1);
    expect(board.items[0].id).not.toBe(threads);
    expect(JSON.stringify(board)).not.toContain("accessToken");
    expect(JSON.stringify(board)).not.toContain("never-return-linkedin-token");
    expect(await call("queue_linkedin_post", { id: first.id })).toMatchObject({
      at: { iso: new Date(threadsAt).toISOString() },
    });
    expect(await call("get_linkedin_post", { id: first.id })).toMatchObject({
      status: { kind: "queued" },
      pinned: false,
    });
    await call("queue_linkedin_post", {
      id: second.id,
      at: "2026-10-19T08:00:00+07:00",
    });
    expect(await call("get_linkedin_post", { id: second.id })).toMatchObject({
      status: { kind: "queued", at: { iso: "2026-10-19T01:00:00.000Z" } },
      pinned: true,
    });
    expect(
      await call("list_linkedin_posts", { view: "scheduled" }),
    ).toMatchObject({
      total: 2,
      counts: { drafts: 0, scheduled: 2, published: 0, failed: 0 },
    });
    await call("unqueue_linkedin_post", { id: second.id });
    await call("delete_linkedin_post", { id: second.id });
    expect(await call("get_linkedin_post", { id: second.id })).toBeNull();
    expect(
      await t.query(api.posts.getPosts, { secret, ids: [threads] }),
    ).toMatchObject({
      posts: [
        {
          meta: { topic: "THREADS-TOPIC" },
          status: { kind: "queued", at: threadsAt },
        },
      ],
    });
    for (const args of [
      { text: " " },
      { text: "a".repeat(3001) },
      { text: "🪵".repeat(3001) },
      {
        text: "Text with unsupported parts",
        parts: [{ text: "Threads part" }],
      },
      { text: "Text with unsupported image", imageId: "image" },
    ]) {
      const before = bridge.mutation.mock.calls.length;
      expect(
        (await invokeTool("create_linkedin_draft", args)).result.isError,
      ).toBe(true);
      expect(bridge.mutation.mock.calls).toHaveLength(before);
    }
    for (const args of [
      { offset: -1 },
      { offset: 1.5 },
      { limit: 0 },
      { limit: 101 },
    ])
      expect(
        (await invokeTool("list_linkedin_posts", { view: "drafts", ...args }))
          .result.isError,
      ).toBe(true);
    expect(
      (
        await invokeTool("update_linkedin_draft", {
          id: first.id,
          topic: "Changed",
        })
      ).result.isError,
    ).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.clearAllMocks();
  }
});

test("LinkedIn MCP publishes through Convex and requires explicit consent to retry an unknown outcome", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  vi.stubEnv("LINKEDIN_API_VERSION", "202608");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T05:45:00+07:00"));
  const t = convexTest(schema, modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    async () =>
      new Response(null, {
        status: 201,
        headers: { "x-restli-id": `urn:li:share:${fetch.mock.calls.length}` },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const call = async (name: string, args: unknown) => {
    const body = await invokeTool(name, args);
    expect(body.result.isError, JSON.stringify(body)).not.toBe(true);
    return JSON.parse(body.result.content[0].text);
  };
  try {
    await t.mutation(api.linkedin.connect, {
      secret: "test-secret",
      memberId: "member",
      name: "Owner",
      accessToken: "fake-token",
      tokenExpiresAt: Date.now() + 86_400_000,
    });
    const first = await call("create_linkedin_draft", {
      text: "Approved LinkedIn post",
    });
    await call("publish_linkedin_post", { id: first.id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      author: "urn:li:person:member",
      commentary: "Approved LinkedIn post",
      visibility: "PUBLIC",
    });
    expect(await call("get_linkedin_post", { id: first.id })).toMatchObject({
      status: {
        kind: "published",
        urn: "urn:li:share:1",
        permalink: "https://www.linkedin.com/feed/update/urn:li:share:1/",
      },
    });
    const uncertain = await t.run((ctx) =>
      ctx.db.insert("linkedinPosts", {
        text: "May already be live",
        source: "agent",
        status: {
          kind: "held",
          at: Date.now(),
          heldAt: Date.now(),
          startedAt: Date.now() - 1000,
          reason: "unknown",
          error: "Response lost",
        },
      }),
    );
    const reviewed = await call("get_linkedin_post", { id: uncertain });
    expect(reviewed.retryAttempt).toBe(Date.now() - 1000);
    for (const args of [
      { id: uncertain },
      { id: uncertain, confirmDuplicateRisk: false },
      { id: uncertain, confirmDuplicateRisk: true },
      {
        id: uncertain,
        confirmDuplicateRisk: true,
        expectedStartedAt: reviewed.retryAttempt - 1,
      },
      {
        id: uncertain,
        confirmDuplicateRisk: false,
        expectedStartedAt: reviewed.retryAttempt,
      },
    ]) {
      const denied = await invokeTool("retry_linkedin_post", args);
      expect(denied.result.isError).toBe(true);
      expect(denied.result.content[0].text).toContain("duplicate");
    }
    expect(
      (await invokeTool("publish_linkedin_post", { id: uncertain })).result
        .isError,
    ).toBe(true);
    expect(await call("get_linkedin_post", { id: uncertain })).toMatchObject({
      status: { kind: "held", reason: "unknown" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await call("retry_linkedin_post", {
      id: uncertain,
      confirmDuplicateRisk: true,
      expectedStartedAt: reviewed.retryAttempt,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetch).toHaveBeenCalledTimes(2);
    const scheduled = await call("list_linkedin_posts", { view: "scheduled" });
    const current = scheduled.items.find(
      (post: { id: string }) => post.id === uncertain,
    );
    expect(current.retryAttempt).toBeGreaterThan(reviewed.retryAttempt);
    const replayed = await invokeTool("retry_linkedin_post", {
      id: uncertain,
      confirmDuplicateRisk: true,
      expectedStartedAt: reviewed.retryAttempt,
    });
    expect(replayed.result.isError).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await call("get_linkedin_post", { id: uncertain })).toMatchObject({
      retryAttempt: current.retryAttempt,
      status: { kind: "held", reason: "unknown" },
    });
    await call("retry_linkedin_post", {
      id: uncertain,
      confirmDuplicateRisk: true,
      expectedStartedAt: current.retryAttempt,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(await call("get_linkedin_post", { id: uncertain })).toMatchObject({
      status: { kind: "published" },
      retryAttempt: null,
    });
    const failed = await t.run((ctx) =>
      ctx.db.insert("linkedinPosts", {
        text: "Rejected before publishing",
        source: "agent",
        status: { kind: "failed", at: Date.now(), error: "Rate limited" },
      }),
    );
    await call("retry_linkedin_post", { id: failed });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(
      await call("list_linkedin_posts", { view: "published" }),
    ).toMatchObject({ total: 3 });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.clearAllMocks();
  }
});
