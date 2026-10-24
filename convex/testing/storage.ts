import type { GenericDatabaseWriter, SystemDataModel } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function storeTestImage(
  ctx: {
    db: MutationCtx["db"];
    storage: { store(blob: Blob): Promise<Id<"_storage">> };
  },
  blob: Blob,
) {
  const imageId = await ctx.storage.store(blob);
  // convex-test 0.0.62 omits blob.type from _storage. Supply production metadata
  // in test setup; the mutation under test still reads ctx.db.system.get.
  const db = ctx.db as unknown as GenericDatabaseWriter<SystemDataModel>;
  await db.patch(imageId, { contentType: blob.type });
  const workspace = await ctx.db.query("workspaces").unique();
  if (!workspace) throw new Error("Missing fixture workspace");
  await ctx.db.insert("assets", {
    workspaceId: workspace._id,
    storageId: imageId,
  });
  return imageId;
}
