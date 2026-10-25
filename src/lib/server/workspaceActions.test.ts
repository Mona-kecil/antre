import { createHash } from "node:crypto";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { workspaceActions } from "./workspaceActions.ts";
import { actions as onboarding } from "../../routes/app/onboarding/+page.server";

const bridge = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: undefined }),
}));
beforeEach(() =>
  bridge.query.mockImplementation(async (ref) =>
    getFunctionName(ref) === "workspaces:current"
      ? { _id: "workspace_test", state: "active", timeZone: "Asia/Jakarta" }
      : null,
  ),
);
afterEach(() => vi.resetAllMocks());
function event(fields: Record<string, string>) {
  return {
    locals: { userId: "user_workos_owner" },
    cookies: { delete: vi.fn() },
    request: new Request("https://antre.example/app/settings", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
  } as never;
}

test("agent keys use 256 random bits and send only SHA-256 hashes to the backend", async () => {
  const first = await workspaceActions.createAgent(
    event({ label: "Writing agent" }),
  );
  const second = await workspaceActions.createAgent(
    event({ label: "Second agent" }),
  );
  expect(first).toHaveProperty("agentToken");
  if (!("agentToken" in first) || !("agentToken" in second))
    throw new Error("Expected issued keys");
  expect(first.agentToken).toMatch(/^antre_[A-Za-z0-9_-]{43}$/);
  expect(first.agentToken).not.toBe(second.agentToken);
  const payload = bridge.mutation.mock.calls[0][1];
  expect(payload).toEqual({
    label: "Writing agent",
    tokenHash: createHash("sha256").update(first.agentToken).digest("hex"),
  });
  expect(JSON.stringify(payload)).not.toContain(first.agentToken);
});

test.each(["", "x".repeat(81)])(
  "invalid agent labels do not create a key",
  async (label) => {
    expect(await workspaceActions.createAgent(event({ label }))).toMatchObject({
      status: 400,
    });
    expect(bridge.mutation).not.toHaveBeenCalled();
  },
);

test("disconnect needs explicit consent and forwards the selected channel", async () => {
  expect(
    await workspaceActions.disconnect(event({ channel: "linkedin" })),
  ).toMatchObject({ status: 400 });
  expect(bridge.mutation).not.toHaveBeenCalled();
  expect(
    await workspaceActions.disconnect(
      event({ channel: "linkedin", confirm: "on" }),
    ),
  ).toHaveProperty("message");
  expect(bridge.mutation).toHaveBeenCalledWith(expect.anything(), {
    channel: "linkedin",
  });
});

test("deletion needs DELETE, then fences the workspace before clearing the session", async () => {
  expect(
    await workspaceActions.deleteWorkspace(event({ confirmation: "delete" })),
  ).toMatchObject({ status: 400 });
  expect(bridge.mutation).not.toHaveBeenCalled();
  await expect(
    workspaceActions.deleteWorkspace(event({ confirmation: "DELETE" })),
  ).rejects.toMatchObject({ status: 303, location: "/?workspace=deleted" });
  expect(getFunctionName(bridge.mutation.mock.calls[0][0])).toBe(
    "workspaces:deleteWorkspace",
  );
});

test.each(["UTC", "America/New_York", "Asia/Jakarta"])(
  "workspace accepts IANA zone %s",
  async (timeZone) => {
    expect(await workspaceActions.timeZone(event({ timeZone }))).toHaveProperty(
      "message",
    );
    expect(bridge.mutation).toHaveBeenCalledWith(expect.anything(), {
      timeZone,
    });
  },
);

test("invalid zones stop before mutation", async () => {
  expect(
    await workspaceActions.timeZone(event({ timeZone: "Mars/Unknown" })),
  ).toMatchObject({ status: 400 });
  expect(bridge.mutation).not.toHaveBeenCalled();
});

test.each([
  ["threads", "/auth/threads"],
  ["linkedin", "/auth/linkedin"],
  ["draft", "/app/compose"],
  ["linkedinDraft", "/app/linkedin/compose"],
])("onboarding saves the zone before %s", async (next, location) => {
  await expect(
    onboarding.start(event({ timeZone: "America/New_York", next })),
  ).rejects.toMatchObject({ status: 303, location });
  expect(bridge.mutation).toHaveBeenCalledWith(expect.anything(), {
    timeZone: "America/New_York",
  });
});

test("a backend failure does not return an unregistered agent credential", async () => {
  bridge.mutation.mockRejectedValueOnce(new Error("backend unavailable"));
  const result = await workspaceActions.createAgent(
    event({ label: "Writing agent" }),
  );
  expect(result).toMatchObject({ status: 400 });
  expect(result).not.toHaveProperty("agentToken");
});
