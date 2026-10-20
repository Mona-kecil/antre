import { api } from "../../convex/_generated/api";
import { convex } from "#lib/server/convex.ts";
import { requireOwner } from "#lib/server/owner.ts";
import { owner } from "#lib/server/owner.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (url.pathname === "/privacy")
    return { account: null, taxonomy: [], badges: { drafts: 0, replies: 0 } };
  if (url.pathname.startsWith("/linkedin")) {
    const { client, secret, account } = await owner(locals.userId);
    const list = await client.query(api.linkedin.list, {
      secret,
      view: "drafts",
      limit: 1,
    });
    return {
      account,
      taxonomy: [],
      badges: { drafts: list.counts.drafts, replies: 0 },
    };
  }
  const { client, secret } = convex();
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
  const account = requireOwner(locals.userId, drafts.account);
  requireOwner(locals.userId, replies.account);
  return {
    account,
    taxonomy,
    badges: { drafts: drafts.counts.drafts, replies: replies.total },
  };
};
