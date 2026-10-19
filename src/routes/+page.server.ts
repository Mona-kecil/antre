import { api } from "../../convex/_generated/api";
import { listParams } from "#lib/server/list.ts";
import { owner } from "#lib/server/owner.ts";
import { postAction } from "#lib/server/postActions.ts";
import { dayStart } from "#lib/time.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, locals }) => {
  const { client, secret } = await owner(locals.userId);
  const view = url.searchParams.get("view") === "failed" ? "failed" : "drafts";
  const { filters, offset, limit } = listParams(url);
  const today = dayStart(Date.now());
  const [list, schedule] = await Promise.all([
    client.query(api.library.page, { secret, view, ...filters, offset, limit }),
    client.query(api.posts.schedule, { secret, from: today, days: 1, day: today }),
  ]);
  return {
    view,
    items: list.items,
    total: list.total,
    counts: list.counts,
    facets: list.facets,
    offset,
    limit,
    nextSlot: schedule.nextSlot,
  };
};

export const actions: Actions = { post: postAction };
