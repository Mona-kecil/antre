import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { expect, vi } from "vitest";
import { api } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";
import schema from "../schema";
const modules = import.meta.glob(["../**/*.ts", "!../**/*.test.ts"]);
export async function ownerTest(
  options: { transactionLimits?: { documentsRead: number } } = {},
) {
  const t = convexTest({ schema, modules, ...options }).withIdentity({
    subject: "test-owner",
    issuer: "https://api.workos.com/",
    tokenIdentifier: "https://api.workos.com/|test-owner",
  });
  await t.mutation(api.workspaces.ensure, {});
  return t;
}
const fixtureWorkspaces = new WeakMap<
  QueryCtx,
  Promise<import("../_generated/dataModel").Id<"workspaces">>
>();
export function fixtureWorkspace(ctx: QueryCtx) {
  let id = fixtureWorkspaces.get(ctx);
  if (!id) {
    id = (async () => {
      const workspace = await ctx.db.query("workspaces").unique();
      if (!workspace) throw new Error("Missing fixture workspace");
      return workspace._id;
    })();
    fixtureWorkspaces.set(ctx, id);
  }
  return id;
}
export async function workspaceIdOf(
  t: Pick<Awaited<ReturnType<typeof ownerTest>>, "query">,
) {
  const workspace = await t.query(api.workspaces.current, {});
  if (!workspace) throw new Error("Missing fixture workspace");
  return workspace._id;
}

type TestAction = Pick<Awaited<ReturnType<typeof ownerTest>>, "action">;
export async function connectThreads(
  t: TestAction,
  args: FunctionArgs<typeof api.account.connect>,
) {
  const previous = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (
        url.origin === "https://graph.threads.net" &&
        url.pathname === "/v1.0/me" &&
        url.searchParams.get("fields") === "id,username"
      ) {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          `Bearer ${args.accessToken}`,
        );
        return Response.json({
          id: args.threadsUserId,
          username: args.username,
        });
      }
      return previous(input, init);
    },
  );
  try {
    return await t.action(api.account.connect, args);
  } finally {
    vi.stubGlobal("fetch", previous);
  }
}
export async function connectLinkedin(
  t: TestAction,
  args: FunctionArgs<typeof api.linkedin.connect>,
) {
  const previous = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.href === "https://api.linkedin.com/v2/userinfo") {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          `Bearer ${args.accessToken}`,
        );
        return Response.json({ sub: args.memberId, name: args.name });
      }
      return previous(input, init);
    },
  );
  try {
    return await t.action(api.linkedin.connect, args);
  } finally {
    vi.stubGlobal("fetch", previous);
  }
}
