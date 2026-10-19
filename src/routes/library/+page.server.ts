import { api } from "../../../convex/_generated/api";
import { convex } from "#lib/server/convex.ts";
import { listParams } from "#lib/server/list.ts";
import { requireOwner } from "#lib/server/owner.ts";
import type { PageServerLoad } from "./$types";

const sorts = ["date", "views", "engagement"] as const;

export const load: PageServerLoad = async ({ url, locals }) => {
  const { client, secret } = convex();
  const { filters, offset, limit } = listParams(url);
  const sort =
    sorts.find((sort) => sort === url.searchParams.get("sort")) ?? "date";
  const list = await client.query(api.library.page, {
    secret,
    view: "published",
    sort,
    ...filters,
    offset,
    limit,
  });
  requireOwner(locals.userId, list.account);
  return {
    sort,
    items: list.items,
    total: list.total,
    facets: list.facets,
    offset,
    limit,
  };
};
