import { convexTest } from "convex-test";
import { api } from "../../../convex/_generated/api";
import schema from "../../../convex/schema";
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
    "list_queue",
    "create_draft",
    "update_draft",
    "queue",
    "unqueue",
    "publish_now",
    "delete_post",
    "taxonomy",
    "set_taxonomy",
    "tag_posts",
    "search_posts",
    "insights",
    "list_replies",
    "reply",
    "hide_reply",
    "sync_now",
  ]);
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
      const body = JSON.parse(
        text.startsWith("event:") ? text.split("data: ")[1].trim() : text,
      );
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
      syncedAt: "2026-10-18T01:00:00.000Z",
      replies: [
        {
          replyId: "reader-reply",
          username: "reader",
          text: "Reader question",
          at: "2026-10-18T00:30:00.000Z",
          permalink: null,
          hidden: false,
          parentText: "Creative library post",
          postId: id,
          postText: "Creative library post",
        },
      ],
    });
    expect(
      await call("list_replies", { postId: id, unanswered: false, limit: 1 }),
    ).toMatchObject({ replies: [{ replyId: "reader-reply" }] });
    expect(
      await t.query(api.library.searchPosts, {
        secret: "test-secret",
        topic: "MY-CODE",
      }),
    ).toHaveLength(1);
  } finally {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});
