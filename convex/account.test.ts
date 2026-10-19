import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

test("first connect claims ownership, reconnect replaces the token, and another Threads user cannot claim it", async () => {
  vi.stubEnv("ANTRE_SECRET", "test-secret");
  try {
    const t = convexTest(schema, modules);
    const account = {
      secret: "test-secret",
      threadsUserId: "owner",
      username: "mona",
      accessToken: "test-token",
      tokenExpiresAt: Date.now() + 100000,
    };
    await t.mutation(api.account.connect, account);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("account").unique();
      if (row) await ctx.db.patch(row._id, { needsReconnect: true });
    });
    await t.mutation(api.account.connect, {
      ...account,
      accessToken: "new-test-token",
    });
    expect(
      await t.query(api.account.current, { secret: "test-secret" }),
    ).toEqual({
      threadsUserId: "owner",
      username: "mona",
      needsReconnect: false,
      tokenExpiresAt: account.tokenExpiresAt,
      lastRefreshError: null,
      lastRefreshErrorAt: null,
    });
    await expect(
      t.mutation(api.account.connect, { ...account, threadsUserId: "other" }),
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
