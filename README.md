# antre

A review console and publisher for one Threads account and one personal LinkedIn profile. SvelteKit 3 serves the UI. Convex stores drafts, reserves queue slots, and runs publishing jobs. The original Threads spec is in [docs/prd.md](docs/prd.md).

## Develop

```sh
npm ci
npx convex dev
npm run dev
```

The project uses `@sveltejs/adapter-vercel`. `npm run build` creates a local build; it does not deploy it.

Convex configuration writes `.env.local`, which is gitignored. Set `ANTRE_SECRET` in the Convex deployment and in the server environment that calls Convex. Never expose it through a `PUBLIC_` variable. All public functions require this secret; internal functions do not.

Set the server variables listed in [.env.example](.env.example). Connect the owner through Threads OAuth at `/login`. No real platform credentials are needed for tests.

Production builds require the server connection and authentication variables. Vercel previews can build the public pages with those values absent. Owner pages and MCP access still require their runtime configuration.

## Connect LinkedIn

1. Create a LinkedIn developer app. Enable **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Antre requests `w_member_social`, `openid`, and `profile`.
2. Register `https://antre-hazel.vercel.app/auth/linkedin/callback` as an authorized redirect URL. The public privacy page is `https://antre-hazel.vercel.app/privacy`.
3. Set `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_REDIRECT_URI` in Vercel's production environment. Keep the secret in the server environment. Rotate it there when the app secret changes.
4. Deploy the Convex functions before deploying the web app. The schema adds LinkedIn tables without changing existing Threads documents or jobs.
5. Log in as the Threads owner, switch to **LinkedIn**, and open **Settings → Connect LinkedIn**. Approve access to the personal profile you want to publish from.

LinkedIn has separate drafts, topics, writing preferences, posting windows, and a library. Topics are internal labels. They are not sent as hashtags. The default schedule has one slot at 08:00 WIB each day. Change it in LinkedIn settings.

The first release publishes one text body of 1–3,000 Unicode code points. Posts remain drafts until queued or published by the owner or an authorized MCP caller. Public reads omit access tokens. Expired access holds LinkedIn posts until the same profile reconnects.

A timeout, server error, or missing publish ID can leave the result unknown. These posts appear as held in Schedule and never resend on reconnect. Check your LinkedIn profile before retrying. The UI requires confirmation, and the MCP retry tool requires `confirmDuplicateRisk: true` plus the current `retryAttempt` as `expectedStartedAt`. Consent for an older attempt is rejected.

The agent uses the `*_linkedin_*` MCP tools and reads `get_linkedin_settings` for this channel's topics and writing preferences. The existing tools keep their Threads behavior. LinkedIn replies, media uploads, imported history, and engagement metrics are outside this release.

## Backend API

Public mutations in `convex/posts.ts`: `createDraft`, `updateDraft`, `setTopicTag`, `queue`, `unqueue`, `publishNow`, `retry`, `deletePost`. Public query: `listQueue`. Every call takes `secret`.

Threads defaults to a `06:00`–`12:00` window in `Asia/Jakarta`, with a `30` minute interval. Change the window in Threads settings. The end time is inclusive. Explicit queue times use Unix milliseconds and may fall outside that window.

- `createDraft` takes `parts`, optional `meta` and `topicTag`, and `source` (`web` or `agent`). Each part needs 1–500 Unicode code points and may reference a stored image. `topicTag` defaults to `Marketing`. An empty string creates a draft without a tag.
- `updateDraft` takes `id` and optional `parts`, `meta`, and `topicTag`. Drafts and failed posts can be edited. Omitted `meta` fields and `topicTag` keep their current values. An empty string clears the supplied field. Parts whose IDs have been saved cannot be changed or removed. The topic cannot change after the first part's ID is saved.
- `setTopicTag` takes `ids` (1–100 post IDs) and `topicTag`. It updates drafts, queued, held, or failed posts in one transaction without moving their schedule. It rejects the batch if any post is publishing or has a published first part. The MCP tool is `set_topic_tag`, with the same arguments.
- `queue` takes `id` and optional `at`, returning the reserved timestamp. Drafts and failed posts can be queued. Queued, publishing, and published posts hold their times.
- `unqueue` takes a queued `id`, cancels its job, and returns it to drafts. `deletePost` cancels a queued job and removes the local record; publishing posts cannot be deleted. It does not delete content from Threads.
- `publishNow` starts a draft, queued, or failed post at the current time. `retry` starts a failed post at the current time. Both keep saved part IDs.
- `listQueue` returns posts sorted by queue time (creation time for drafts). Optional `days` limits scheduled times to that many days ahead; drafts and history remain visible. It never returns account tokens.

The composer and MCP tools `create_draft` and `update_draft` expose `topicTag` as the public Threads topic. A tag has 1–50 Unicode code points and cannot contain a period or ampersand. The publisher sends it as `topic_tag` on the first part only. The internal `meta.topic` label remains separate.

Queuing and scheduling share one mutation. The internal `fire` mutation starts publishing only from `queued`. The action saves each part ID before sending the next reply and reads the first part's permalink at completion. Errors preserve progress. Error 190 flags the account for reconnecting. An attempt timestamp stops an action from overwriting a later retry's state.

Retries check exact text in the account's recent root-post or reply feed. Reply matches must also have the expected parent ID. The check requests posts since draft creation, up to the latest 100 results per unfinished part. This reduces duplicates after a timeout; it cannot guarantee idempotency if a post is absent from that feed or has fallen beyond its first page. The Threads publish endpoint has no idempotency key.

Crons fail publishing attempts older than 10 minutes every 10 minutes and refresh the token on Mondays at 00:00 UTC. Any refresh failure flags `needsReconnect`.

## Verify

```sh
npm run check
npm test
npm run build
npx convex dev --once
```

`npx convex dev` targets the dev deployment named by `CONVEX_DEPLOYMENT` in `.env.local`, which holds no posts. The app reads the production deployment through `CONVEX_URL`. Pushing to `main` deploys the Convex functions and then the app. The production build in `vercel.json` runs `npx convex deploy` with the `CONVEX_DEPLOY_KEY` set in Vercel's production environment. Preview builds skip Convex. Run production functions with `npx convex run --prod`.

Seven Convex flow tests use `convex-test`, the edge runtime, fake timers, and a global `fetch` fake. They cover WIB slot rollover and scheduled publishing, reply chains and images, rejected and ambiguous publishes, cancellation and occupied times, token errors and refresh, stale publishers, secret checks, and invalid drafts. Crons are invoked by their registered target because `convex-test` does not execute cron schedules.

Live Threads publishing remains untested. Requests follow [Meta's Threads Postman collection](https://www.postman.com/meta/threads/collection/dht3nzz/threads-api), including the [account replies feed](https://www.postman.com/meta/threads/request/2oj5hld/get-a-list-of-all-a-user-s-replies). Confirm permissions for reading replies, image-container readiness, token refresh responses, rate limits, and feed visibility after a timeout in the PRD's live-account spike.
