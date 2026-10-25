# Public workspace rollout

The production ownership migration has run, as reported by the operator: `migrations:backfill` returned done, `migrations:bindLegacyOwner` bound the owner, and `migrations:check` returned `{ready:true, errors:[]}`. Every owned row has a workspace, the workspace has an owner, and the production settings row uses `windows`, `gapPolicy`, `intervalMinutes`, `timeZone`, and `workspaceId`.

The schema was then tightened in source to require ownership and accept only the current settings shape. This source change has not been deployed or checked against production here. The sections below preserve the cutover procedure and its historical migration commands; those functions have now been removed from the source.

## Local verification

Source at `98c0c0a` passed 263 tests, the Svelte type check with zero diagnostics, and the production build. A separate checkout built with only `.env.example`; its landing, demo, and privacy pages returned 200 without credentials. Private routes reported the missing login configuration.

The browser checks covered desktop and phone layouts, demo draft and queue operations, simulated publication, persistence, and reset. The demo made no backend or provider requests. A temporary WorkOS staging user completed hosted sign-in, returned through the callback to onboarding, saved a draft in a new workspace, and signed out. The test identity was removed and workspace cleanup was scheduled.

`node scripts/check-workspaces.mjs --local` passed seven checks against WorkOS staging and loopback Convex: distinct JWT-backed workspaces, foreign-record rejection, personal MCP access and revocation, media isolation, one-use HTTP uploads, private session rendering, and deletion fencing. This did not test production or publish a remote post.

An independent GPT-6-astra review found two defects: a replaced LinkedIn token could strand an unsent attempt, and a full batch of new legacy rows could skip rebuilding a completed migration. Both fixes passed re-review. Each regression test failed against the earlier source. Cross-family review could not run because the Claude requests hit rate limits.

Hosted session refresh, completed asynchronous deletion, migration and backup-restore rehearsal, and non-owner provider approval and publication remain unverified by the local checks above. Production owner binding and migration readiness were later reported by the operator, as recorded above. The steps below cover the production rollout. The decision trail is in `.audit/public-workspaces.tsv`.

## Prepare

1. Finish local checks and a development rehearsal. Confirm the web server and Convex client use the same deployment.
2. Configure a production WorkOS environment. Register the production callback and logout URIs. Use its matching client ID and API key in the web server, and its client ID in Convex. Keep staging credentials separate.
3. Verify the owner's WorkOS subject through WorkOS. Record the expected subject before binding. An email string or the first person to sign up cannot claim legacy records.
4. Check each advertised posting channel with a non-owner account. Record the provider permissions, a successful publication, and any approval requirement. Source configuration alone does not pass this check.
5. Choose a maintenance window with no active publishing attempts and no queue slots due during the migration. Block public signup and private writes during cutover. Export a Convex backup, including storage, and keep it outside the repository.

The web and backend authorization boundaries change together. The old web server's shared secret cannot call the new backend. Plan for that maintenance window instead of leaving a global-secret fallback enabled.

## Backfill and bind

These commands describe the migration-capable backend used for the completed cutover. They are historical references and are unavailable after deploying the tightened source. The examples used `--prod` to make the target explicit; development rehearsals omitted it and targeted development.

Deploy the migration-capable backend, then save its initial inventory:

```sh
npx convex run --prod migrations:inventory '{}'
```

Keep the returned table counts, unbound counts, post IDs, job IDs, and UTC times as the comparison artifact. These contain private identifiers; do not commit the output.

Run the backfill until it reports `done: true`:

```sh
npx convex run --prod migrations:backfill '{}'
```

To preserve the current agent key, supply its SHA-256 hex hash through `legacyTokenHash`. Compute that hash through a private local process; do not paste the raw key into chat or shell history. The backfill can also read an existing Convex `MCP_TOKEN` for this migration only. Normal API requests never use that global variable.

Bind the verified WorkOS subject through the internal operator function:

```sh
npx convex run --prod migrations:bindLegacyOwner '{"subject":"user_VERIFIED_OWNER"}'
```

A subject that owns a nonempty new workspace cannot replace it with the legacy workspace. Complete binding before the owner creates new content. The operation accepts the same binding again and rejects a different owner.

Run the backfill again and compare the inventory. It must report no changed records and preserve scheduled job IDs, UTC times, partial publication IDs, connection tokens, saved reply drafts, settings, and asset ownership. Then run:

```sh
npx convex run --prod migrations:check '{}'
```

Require `ready: true` with no errors. Inspect existing queued and held posts before reopening writes. A missed slot or ambiguous publishing result needs the channel's recovery flow; do not reset receipts or force a resend.

## Open the app

Deploy the matching web build. Verify the owner sees the migrated workspace after WorkOS login. Verify a second user gets an empty private workspace, cannot connect the legacy profile, and cannot read or change the owner's records or media. Exercise one owned queue per channel with test accounts and inspect the publishing result.

Check personal agent access and revoke a test key. Keep `iso` and `wib` fields in MCP responses. Check that the public landing and demo work without a session and that demo edits produce no backend writes.

Remove the old `ANTRE_SECRET`, `SESSION_SECRET`, and global `MCP_TOKEN` from normal runtime configuration after migration and agent verification. Reopen signup and writes only when these checks pass and the required-ownership schema has been deployed.

## Tighten the schema

After the reported migration, this source makes every owned `workspaceId`, provider receipt `workspaceId`, and workspace `ownerId` required. It removes the old settings shape, settings adapters, and ownership/settings/library migration functions. Runtime authorization still checks workspace identity, existence, and active state.

The optional `legacy: true` marker and `workspaceMigrations` table remain accepted because the completed migration wrote them to production. No runtime path reads the marker; its lookup index has been removed. Cleanup still removes migration progress rows with their workspace. Removing these stored fields requires a separate data cleanup before removing their validators.

Provider callback receipts retain their workspace ID after workspace deletion until expiry. Convex IDs are not foreign keys. Verified callbacks for unknown profiles use a separate global completion receipt with no workspace data; they never create or claim a workspace.

Rehearse the schema push against migrated development data before deployment. Convex validates existing documents on deploy: the required-field schema should be accepted when all stored documents satisfy it, and must fail if any owned row lacks `workspaceId`, any workspace lacks `ownerId`, or any settings row still has the old shape. No schema push was run for this change.

## Recovery

If a gate fails, keep signup and writes closed. Save the inventory and error before changing state. On the historical migration-capable backend, repeated backfill and the same owner binding were designed to converge on the same workspace. Do not bind a different user to work around an error.

A code rollback must account for data written by multiple workspaces: the old singleton queries cannot read a public deployment after additional users have signed up. Restore from the pre-cutover backup only while writes remain blocked and after reconciling any remote publications made during the window. Remote posts are outside the database backup.
