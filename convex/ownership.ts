import type { TableNames } from "./_generated/dataModel";
import schema from "./schema";

export const globalTables = [
  "users",
  "workspaces",
  "providerReceipts",
] as const;
export type OwnedTable = Exclude<TableNames, (typeof globalTables)[number]>;
export function isOwnedTable(name: string): name is OwnedTable {
  return (
    Object.hasOwn(schema.tables, name) &&
    !globalTables.some((table) => table === name)
  );
}
export const ownedTables = Object.keys(schema.tables).filter(isOwnedTable);
