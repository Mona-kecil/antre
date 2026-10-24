import { api } from "../../../convex/_generated/api";
import { owner } from "#lib/server/owner.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const { client, secret, account, workspace } = await owner(locals.userId);
  if (url.pathname.startsWith("/app/linkedin")) {
    const list = await client.query(api.linkedin.list, {
      secret,
      view: "drafts",
      limit: 1,
    });
    return {
      settings: list.settings,
      workspace,
      account,
      taxonomy: [],
      badges: { drafts: list.counts.drafts, replies: 0 },
    };
  }
  const [taxonomy, drafts, replies, settings] = await Promise.all([
    client.query(api.library.taxonomy, { secret }),
    client.query(api.library.page, { secret, view: "drafts", limit: 1 }),
    client.query(api.replies.list, {
      secret,
      drafted: true,
      unanswered: false,
      limit: 1,
    }),
    client.query(api.posts.getSettings, { secret }),
  ]);
  return {
    settings,
    workspace,
    account,
    taxonomy,
    badges: { drafts: drafts.counts.drafts, replies: replies.total },
  };
};
