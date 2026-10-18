import { error } from "@sveltejs/kit";
import { api } from "../../../convex/_generated/api";
import { convex } from "#lib/server/convex.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const { client, secret } = convex();
  const [account, taxonomy, posts] = await Promise.all([
    client.query(api.account.current, { secret }),
    client.query(api.library.taxonomy, { secret }),
    client.query(api.library.searchPosts, {
      secret,
      status: "published",
      limit: 10000,
    }),
  ]);
  if (!account || account.threadsUserId !== locals.userId)
    error(403, "This session does not belong to the owner");
  return { account, posts, taxonomy };
};
