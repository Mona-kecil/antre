import { api } from "../../convex/_generated/api";
import { owner } from "#lib/server/owner.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  const { client, secret, account } = await owner(locals.userId);
  const [taxonomy, drafts, replies] = await Promise.all([
    client.query(api.library.taxonomy, { secret }),
    client.query(api.library.page, { secret, view: "drafts", limit: 1 }),
    client.query(api.replies.list, {
      secret,
      drafted: true,
      unanswered: false,
      limit: 1,
    }),
  ]);
  return {
    account,
    taxonomy,
    badges: { drafts: drafts.counts.drafts, replies: replies.total },
  };
};
