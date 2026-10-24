import { expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { connectThreads, ownerTest } from "./testing/workspace.test-support";

test("workspace connects one verified Threads identity and reconnect replaces the token", async () => {
  try {
    const t = await ownerTest();
    const account = {
      threadsUserId: "owner",
      username: "mona",
      accessToken: "test-token",
      tokenExpiresAt: Date.now() + 100000,
    };
    await connectThreads(t, account);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("account").unique();
      if (row) await ctx.db.patch(row._id, { needsReconnect: true });
    });
    await connectThreads(t, {
      ...account,
      accessToken: "new-test-token",
    });
    expect(await t.query(api.account.current, {})).toEqual({
      threadsUserId: "owner",
      username: "mona",
      needsReconnect: false,
      tokenExpiresAt: account.tokenExpiresAt,
      lastRefreshError: null,
      lastRefreshErrorAt: null,
    });
    await expect(
      connectThreads(t, { ...account, threadsUserId: "other" }),
    ).rejects.toThrow("another Threads account");
    expect(
      await t.run(
        async (ctx) => (await ctx.db.query("account").unique())?.accessToken,
      ),
    ).toBe("new-test-token");
  } finally {
    vi.unstubAllEnvs();
  }
});
