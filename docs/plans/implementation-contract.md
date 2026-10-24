# Public workspace implementation contract

The public release includes a browser-local demo and personal publishing. WorkOS AuthKit supplies app identity. Platform OAuth connects posting profiles and does not log users into Antre.

## Shared backend contract

- Keep existing channel API names and domain arguments. The optional `secret` argument becomes a personal agent credential. It must never authorize through the global `ANTRE_SECRET`.
- Web calls authenticate with a verified WorkOS access token through `ConvexHttpClient.setAuth`. They omit `secret`.
- `workspaces.ensure({timeZone?})` is an authenticated mutation that creates the current user's personal workspace once. `workspaces.current({secret?})` returns its public workspace record, or null for an authenticated user who has not created one. Use `ctx.auth` identity, never a caller-supplied user ID.
- Workspace records contain `ownerId`, `state` (`active` or `deleting`), and `timeZone`. User records identify the WorkOS subject. Every existing owned table gains `workspaceId`; migration-only unbound records fail closed.
- Queries, mutations, media, and agents resolve workspace authority at the backend boundary. Foreign record IDs and foreign related IDs are rejected. Keep channel modules and their publishing behavior separate.
- `workspaces.updateTimeZone({timeZone})`, `createAgentGrant({label,tokenHash})`, `revokeAgentGrant({id})`, `listAgentGrants({})`, `disconnect({channel})`, and `deleteWorkspace({})` support settings. Return no raw credentials. Generate agent bearer tokens in the SvelteKit server and store only their SHA-256 hashes.
- `account.connect` and `linkedin.connect` validate tokens with their providers before an internal mutation attaches the grant to the authenticated workspace. These public entry points are actions. Remote identities cannot belong to two workspaces. Reconnecting to a different identity cannot redirect queued posts.
- Post-job arguments keep current IDs and generation fields. Jobs derive ownership from stored records. Connection-level jobs receive a trusted workspace or connection reference. No missing-owner fallback.
- Preserve partial Threads IDs, attempt guards, retry limits, auth holds, and unknown LinkedIn outcomes. Disconnect blocks later dispatches while results already dispatched remain recordable.
- Add scoped asset registration/upload support. Validate ownership before preview, attach, or delete. Do not accept a guessed storage ID as ownership proof.
- Internal migration operations backfill existing records into a legacy workspace, bind it to an operator-verified WorkOS subject, and preserve job IDs and times. These are not exposed through public signup.

## Shared web contract

- `/` is public. `/demo` is browser-local and uses synthetic fixtures. `/login` starts WorkOS AuthKit. `/auth/workos/callback` completes it. `/logout` signs out. `/app/**` contains live private pages.
- Move current private layouts and pages under `/app`; route groups alone do not change URLs. The root layout imports global styles and renders children without private data or navigation.
- WorkOS session handling sets `locals.userId` and `locals.accessToken`. Protected handlers use that token. Platform callbacks bind OAuth state to the authenticated app session and workspace.
- `convex()` may read the current request through SvelteKit request context and returns `{client, secret: undefined}` after setting the WorkOS token. A dedicated `agentConvex(token)` returns `{client, secret: token}` only for MCP. No singleton client with mutable authentication.
- `owner(userId)` authorizes the app identity and returns a scoped client plus the workspace's Threads account, which may be null. A LinkedIn-only user does not need Threads. Remove checks comparing WorkOS user IDs with Threads profile IDs.
- WorkOS variables are server-only: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`. Missing setup must leave public/demo pages usable and give login a clear setup error. Do not invent credentials or log them.
- Existing channel and composer pages remain the main product UI. Update links, form targets, and relative imports after moving them.

## Time contract

Use an IANA timezone per channel, defaulting from the workspace. Keep existing owner's Asia/Jakarta settings and queued UTC instants. Skip nonexistent local slots and choose the earlier repeated slot. Shared helpers retain existing call signatures with optional timezone parameters: `when(at, now?, timeZone?)`, `wib(at)`, `clock(at,timeZone?)`, `dayLabel(at,timeZone?)`, `dayStart(at,timeZone?)`, `isoDay(at,timeZone?)`, `parseDay(value,timeZone?)`, `localInput(at,timeZone?)`, `parseLocal(value,timeZone?)`. Backend owns shared time helpers in `src/lib/time.ts` and `src/lib/timezone.ts`.

## Independent file ownership

- Backend work owns `convex/**`, shared time helpers, and backend tests.
- Web work owns `src/**` except the shared time helpers and the new public/demo pages.
- Root integration owns package files, docs, public/demo pages, tooling, integration checks, and merges.

All implementation work occurs in separate worktrees. Each worker commits its slice and returns commit IDs and test evidence. No production deployment or data migration runs during local implementation.
