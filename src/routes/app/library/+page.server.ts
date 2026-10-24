import { api } from "../../../../convex/_generated/api";
import { listParams } from "#lib/server/list.ts";
import { owner } from "#lib/server/owner.ts";
import type { PageServerLoad } from "./$types";

const sorts = ["date", "views", "engagement"] as const;

export const load: PageServerLoad = async ({ url, locals }) => {
  const { client, secret, account, workspace } = await owner(locals.userId);
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
  return {
    sort,
    items: list.items,
    total: list.total,
    facets: list.facets,
    offset,
    limit,
  };
};
