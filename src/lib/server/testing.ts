import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { storeTestImage } from "../../../convex/testing/storage";
import schema from "../../../convex/schema";

export const workosOwner = "user_workos_owner";
export const workosOther = "user_workos_other";
export const agentToken = "test-secret";

export async function workspaceTest(
  modules: Record<string, () => Promise<unknown>>,
  transactionLimits?: { documentsRead: number },
) {
  const store = convexTest({ schema, modules, transactionLimits });
  const identity = (subject: string) => ({
    subject,
    issuer: "https://api.workos.com/user_management/client_test",
    tokenIdentifier: `https://api.workos.com/user_management/client_test|${subject}`,
  });
  const t = store.withIdentity(identity(workosOwner));
  const other = store.withIdentity(identity(workosOther));
  await t.mutation(api.workspaces.ensure, { timeZone: "Asia/Jakarta" });
  const workspace = await t.query(api.workspaces.current, {});
  if (!workspace) throw new Error("Expected an authenticated workspace");
  await t.mutation(api.workspaces.createAgentGrant, {
    label: "Test agent",
    tokenHash: createHash("sha256").update(agentToken).digest("hex"),
  });
  return { t, other, store, workspaceId: workspace._id };
}

export async function storeOwnedImage(
  ctx: Parameters<typeof storeTestImage>[0],
  workspaceId: Id<"workspaces">,
  blob: Blob,
) {
  const storageId = await storeTestImage(ctx, blob);
  await ctx.db.insert("assets", { workspaceId, storageId });
  return storageId;
}
