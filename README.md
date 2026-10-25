# antre

Antre reviews drafts and publishes scheduled posts to Threads and personal LinkedIn profiles. SvelteKit serves the site and MCP endpoint. Convex stores workspace data and runs publishing jobs. WorkOS AuthKit handles app login; platform OAuth connects posting profiles after login.

- `/` introduces the app.
- `/demo` uses synthetic data stored in the current browser. It cannot publish to a platform. Reset clears its saved edits.
- `/app` holds a signed-in user's private workspace. Threads and LinkedIn keep separate posts, settings, and queues.
- `/mcp` accepts a personal agent key created in workspace settings.

This branch prepares the public release. Production migration and non-owner platform access checks remain separate release steps. The original Threads specification is in [docs/prd.md](docs/prd.md); the public architecture and implementation contract are in [docs/plans](docs/plans/public-workspaces.md).

## Develop

```sh
npm ci
npx convex dev
npm run dev
```

Use the same Convex deployment for the web server's `CONVEX_URL` and `CONVEX_DEPLOYMENT`. The old local setup pointed the web server at production while the Convex CLI used development. Check both before testing writes.

Set server variables from [.env.example](.env.example). Public pages and the demo work without credentials. Login and private operations report missing configuration when requested. Keep all keys server-side; do not use a `PUBLIC_` prefix.

## WorkOS

Create a WorkOS staging environment for development. Register `http://localhost:5173/auth/workos/callback` as a redirect URI and `http://localhost:5173/` as a logout URI. Set:

- `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` from that same environment.
- `WORKOS_COOKIE_PASSWORD` to a private random value of at least 32 characters.
- `WORKOS_REDIRECT_URI` to the registered callback.

Set `WORKOS_CLIENT_ID` in the matching Convex deployment too:

```sh
npx convex env set WORKOS_CLIENT_ID client_your_staging_client
```

`convex/auth.config.ts` validates AuthKit JWTs with WorkOS's JWKS. Each server request creates its own Convex client and sets the verified user's access token. The old `ANTRE_SECRET`, `SESSION_SECRET`, and global `MCP_TOKEN` do not authorize app requests.

The WorkOS CLI is available through `npx workos@latest`. `profile list` shows local profiles. Check the project, environment, and client ID together: an environment target alone does not replace the profile's API credentials.

## Posting profiles

Threads needs `THREADS_APP_ID` and `THREADS_APP_SECRET`. Register `/auth/callback` on the app origin as its OAuth callback. The same app secret must be set in Convex for signed Meta uninstall and deletion callbacks.

LinkedIn needs **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Antre requests `w_member_social`, `openid`, and `profile`. Set `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_REDIRECT_URI`; register `/auth/linkedin/callback` on the app origin. The privacy page is `/privacy`.

Sign in to Antre, then connect either profile from onboarding or settings. A LinkedIn-only workspace does not need Threads. Connections verify the platform token's identity before storage. A remote profile can belong to one workspace; reconnecting must use that same profile so queued posts cannot change destination.

Provider credentials and source configuration do not prove public approval. Test each advertised channel with a non-owner account before launch.

## Publishing behavior

Threads supports multipart posts, images, replies, metrics, and imported history. Each part allows 1–500 Unicode code points. Published part IDs are saved between requests so recovery can resume a partial thread. Recovery searches recent remote posts for matching text and parent IDs; this reduces duplicates but does not guarantee idempotency.

LinkedIn supports one text post of 1–3,000 Unicode code points. A timeout, server error, or missing success ID can leave the result unknown. These posts are held until the user checks their profile and confirms duplicate risk for the current attempt. Reconnecting does not resend an unknown result. LinkedIn images, Pages, replies, engagement metrics, and history import are outside this release.

Queues live on post status records. A queued post stores its time, job ID, and generation. Background jobs derive the workspace from persisted records. The schema requires workspace ownership and a workspace owner. The two channel engines remain separate.

Automatic slots use the channel's IANA timezone. Each posting window starts its own interval grid, with inclusive endpoints. A nonexistent local slot is skipped; a repeated local slot uses its earlier occurrence. Explicit future timestamps can fall outside automatic windows. Changing timezone leaves existing queued UTC instants fixed. The legacy workspace keeps Asia/Jakarta.

Threads transient failures retry after 1, 5, and 15 minutes. Recovery sweeps run every 10 minutes and inspect attempts older than 15 minutes. Threads token refresh runs daily at 00:00 UTC, library sync at 01:00 UTC, and reply sync hourly. No cron refreshes LinkedIn tokens or imports LinkedIn history.

Signing out ends the browser session and leaves scheduled publishing running. Disconnecting removes the usable channel token and blocks further dispatch until reconnect. Deleting a workspace blocks access and dispatch, cancels queued jobs, then removes stored data. A request sent before disconnect or deletion can still finish; its receipt remains recordable during cleanup. Published remote posts stay online.

## Agents and images

Create an agent key in settings and send it as `Authorization: Bearer …` to `/mcp`. Only the key hash is stored. Each key belongs to one workspace and can be revoked. Agent keys cannot manage user identity, connect posting profiles, create more keys, or delete the workspace.

The existing Threads and `*_linkedin_*` tool names stay in place. Timestamp objects keep `iso` and `wib`, with `local` and `timeZone` added. An omitted draft label keeps its stored value; an empty label clears it.

Image ingestion records workspace ownership. A storage ID alone cannot claim an image. Preview, attachment, and deletion check that ownership. Platform publishers receive storage URLs for the selected workspace's attachments.

## Verify and release

```sh
npm run check
npm test
npm run build
```

Tests exercise workspace isolation, owned media, personal agent grants, timezone transitions, and publishing recovery with simulated provider responses. Live provider approval and posting need separate account tests.

Pushing to `main` deploys the Convex functions and then the app. The production build in `vercel.json` runs `npx convex deploy` with the `CONVEX_DEPLOY_KEY` set in Vercel's production environment. Preview builds skip Convex. Run production functions with `npx convex run --prod`.

With the local Convex server and web server running, the integration check uses two temporary WorkOS staging users:

```sh
node scripts/check-workspaces.mjs --local
```

It requires a loopback Convex URL and staging WorkOS key. It checks real JWTs, private SSR pages, foreign IDs, media ingestion, one-use upload tickets, MCP access and revocation, and workspace deletion fencing. It removes the temporary WorkOS users and schedules local workspace cleanup when it finishes. It never connects posting profiles or publishes remote posts.

For production, pass a dotenv file and a JSON array of owner post IDs kept outside the repository:

```sh
node scripts/check-workspaces.mjs --prod --env /path/to/production.env --foreign-ids /path/to/owner-post-ids.json
```

Production mode requires a live WorkOS API key, client ID, a session sealing password of at least 32 characters, and `CONVEX_URL=https://hip-wolverine-557.convex.cloud`. It targets `https://antre-hazel.vercel.app`, creates passwordless temporary users, and authenticates them with Magic Auth. An explicit dotenv file overrides matching process variables; missing values fall back to the process environment. The optional ID file checks owner posts through read queries from both temporary workspaces. The script deletes only those temporary workspaces and WorkOS users. This mode has not been run against production for this change.

`npm run build` creates a Vercel build; it does not deploy it. `npx convex dev --once` changes the selected development backend. `npx convex deploy` changes production. The operator reports the production owner migration is complete; this source then requires ownership. Convex validates stored documents on deployment and rejects rows that lack required fields. See the [rollout history and schema gate](docs/plans/public-workspaces-rollout.md).
