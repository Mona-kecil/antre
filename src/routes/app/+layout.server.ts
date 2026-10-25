import { api } from "../../../convex/_generated/api";
import { owner } from "#lib/server/owner.ts";
import { linkedinWeek, threadsWeek } from "#lib/server/week.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const { client, secret, account, workspace } = await owner(locals.userId);
  const timeZone = workspace.timeZone;
  if (url.pathname.startsWith("/app/linkedin")) {
    const { week, drafts, settings } = await linkedinWeek(
      { client, secret },
      url,
      timeZone,
    );
    return {
      settings,
      workspace,
      account,
      taxonomy: [],
      badges: { drafts, replies: 0 },
      week,
    };
  }
  const [taxonomy, drafts, replies, settings, week] = await Promise.all([
    client.query(api.library.taxonomy, { secret }),
    client.query(api.library.page, { secret, view: "drafts", limit: 1 }),
    client.query(api.replies.list, {
      secret,
      drafted: true,
      unanswered: false,
      limit: 1,
    }),
    client.query(api.posts.getSettings, { secret }),
    threadsWeek({ client, secret }, url, timeZone),
  ]);
  return {
    settings,
    workspace,
    account,
    taxonomy,
    badges: { drafts: drafts.counts.drafts, replies: replies.total },
    week,
  };
};
