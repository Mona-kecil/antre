import { convexTest } from "convex-test";
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

test("MCP rejects missing or wrong bearer tokens, then initializes and lists library and queue tools", async () => {
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
    "list_queue",
    "create_draft",
    "update_draft",
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
  ]);
  const send = body.result.tools.find(
    (tool: { name: string }) => tool.name === "send_reply",
  );
  expect(Object.keys(send.inputSchema.properties)).toEqual(["replyId", "text"]);
  expect(send.inputSchema.required).toEqual(["replyId", "text"]);
  expect(send.inputSchema.properties.text.description).toBe(
    "the exact draft text the human saw and approved; must match the stored draft",
  );
  expect(send.annotations).toMatchObject({
    destructiveHint: true,
    openWorldHint: true,
  });
  expect(send.description).toContain("explicitly told you to send it");
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
    expect(await call("list_queue", {})).toEqual(
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
