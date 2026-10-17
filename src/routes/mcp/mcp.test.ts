import { expect, test, vi } from "vitest";
import {
  PROTOCOL_VERSION_META_KEY,
  CLIENT_CAPABILITIES_META_KEY,
} from "@modelcontextprotocol/server";
import { POST } from "./+server";

vi.mock("$app/env/private", () => ({ MCP_TOKEN: "test-mcp-token" }));

test("MCP rejects missing or wrong bearer tokens, then initializes and lists the seven tools", async () => {
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
  ]);
});
