import { names, settings, taxonomy, username } from "#lib/demo/fixtures.ts";
import type { PageLoad } from "./$types";

// The home page shows a sample workspace; the shared components read these from page.data.
export const load: PageLoad = () => ({
  taxonomy,
  settings,
  account: { username },
  connection: { name: names.linkedin },
});
