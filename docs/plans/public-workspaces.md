# Recommended plan: public demo + personal publishing (one release)

## Verdict

**Base: B** for domain, isolation, and migration. **Graft from A:** route split, browser demo, schema test, API sweep. **Reject B's separate demo deployment.** Neither candidate is ready to adopt unchanged.

| Criterion | A | B |
| --- | --- | --- |
| 1 Demo + live publishing | 4: both ship; the Threads "invite-only" fallback can narrow the offer | 5: both ship; each advertised channel is gated |
| 2 Isolation | 4: full coverage, but through a generic `ScopedDb` | 5: adds foreign-reference checks, OAuth state binding, credential projection |
| 3 Owner migration | 3: first Threads connect auto-claims; "exactly once" over-promises | 5: admin-bound identity, restore rehearsal, legacy job signatures, no fallback |
| 4 Small boundaries | 3: route groups are right; `ScopedDb` and `DemoStore` are new subsystems; MCP time fields break | 3: engines kept; adds a second deployment, guest issuer, and `Scope` on every call; layout leak unaddressed |
| 5 Launch evidence | 3: concrete checks, but exactly-once can't be tested | 4: DST, receipt/unknown outcomes, per-channel gates; checks less concrete |

**Red flags:**
- A's `ScopedDb` is a shallow wrapper.
- `DemoStore` is a second way to run the same transitions. Accept it only on shared pure functions plus a parity test.
- A credits "no server files" for keeping private data out of the demo. Moving the root layout is what does it.
- B's simulator build boundary needs a packaging proof. This plan avoids that dependency with a browser-local demo.
- Post attempt and schedule generations do not track every connection change. Recheck connection state before each platform dispatch, and preserve in-flight receipts after disconnect.
- In both, the owned-table list is kept by hand. Derive it from the schema.

## Caller flow

- **`/`** is public: Try demo, Create account, Privacy, Login. The root layout loads nothing.
- **`/demo/**`** runs in the browser on fixtures timed relative to now. It supports compose, queue, move, swap, simulated publish, retry, settings, and reset. It is labelled "Demo, nothing posts online" and makes no network writes. "Create real account" starts an empty workspace.
- **Signup** is a standard app login, separate from platform OAuth. It creates one empty workspace and confirms a browser-suggested IANA time zone. The user then connects LinkedIn, Threads, or both, sees the profile, and publishes. Settings → Agent issues a revocable MCP grant.
- **Original owner:** an operator binds the legacy workspace to the owner's verified identity.

## Domain sketch

```ts
users { tokenIdentifier }                                   // from ctx.auth
workspaces { ownerId: Id<"users">; state: "active" | "deleting" }
agentGrants { workspaceId; hash; label; revokedAt? }
assets { workspaceId; storageId }                           // by_storageId
// every owned table gains workspaceId; its indexes lead with it

type Access = { workspaceId: Id<"workspaces">; via: "user" | "agent" }; // built only in access.ts
ownerQuery / ownerMutation / ownerAction                    // replace withSecret 1:1
ownedRow(ctx, access, table, id): Promise<Doc>              // foreign row → same NotFound as missing
```

Domain modules keep explicit queries that lead with `workspaceId`. The access boundary resolves either a verified user identity or a hashed, revocable agent credential into one workspace. The SvelteKit MCP endpoint uses that boundary before domain operations. A client-supplied workspace ID grants no authority. An unbound legacy workspace exists only during migration; bind its verified owner before enforcing the final schema and opening signup.

## Modules

- **New:**
  - `convex/access.ts`: identity → workspace, grant verification, `ownedRow`.
  - `convex/workspaces.ts`: ensure, grants, internal `bindLegacyOwner`, delete.
  - `convex/migrations.ts`.
- **Connections** (`account.ts`, `linkedin.ts`): `query("account").unique()` becomes a `by_workspace` lookup. A remote ID can belong to only one workspace. Single-use OAuth state binds session, workspace, and channel.
- **Jobs** (`publishing.ts`, `sync.ts`, `replies.ts`): existing post-job arguments stay. Post jobs derive the workspace from the stored post. Connection-level sync and refresh jobs receive an internally resolved connection and workspace reference. Every lookup and cleanup stays inside that workspace.
- **Assets** (`images.ts`): ingestion records workspace ownership. Preview, attachment, and deletion enforce it. Audit permanent storage URLs; authenticated previews and provider media delivery must respect workspace ownership. Add per-workspace upload and queue limits.
- **Crons:** refresh, sync, and replies page through connected workspaces and run one job per workspace, so one failure doesn't stop the rest. `sweepStuck` stays global.
- **Engines:** Threads and LinkedIn publishing, holds, retries, and receipt/unknown handling stay separate. No plugin layer.
- **Routes:**
  - `(public)/`: landing, privacy, login, and `demo/**` (`ssr = false`, no server files).
  - `(app)/app/**`: takes today's private layout loaders, `TabBar`, and existing app pages under `/app`. Route groups alone do not add a URL prefix. Update navigation and protect redirects from old app deep links without colliding with the public `/` page.
  - Shared page bodies go in `src/lib/views/` and take `data` and `submit`.
  - `src/lib/demo/` holds fixtures and a `DemoStore` built on pure functions extracted from `lib/scheduling.ts` and `postActions.ts`.
- **Time:**
  - Each channel's settings row keeps its `timeZone`. Both channels use `queueSettings`, whose timezone is an Asia/Jakarta literal. Widen and validate that shared field, then replace fixed-WIB calculations across backend, UI, and MCP.
  - A nonexistent local slot is skipped. A repeated local time takes the earlier occurrence. Queued posts keep their absolute instants when settings change.
  - The owner stays on Asia/Jakarta.
  - MCP keeps `{iso, wib}` and adds `local` and `timeZone`.

## Milestones (gates inside one launch)

1. **Verification spike, no product code.** Record evidence for:
   - the Threads permissions the Meta dashboard grants to non-testers;
   - LinkedIn product config, checked with a second consenting account;
   - an auth vendor whose SvelteKit 3 server token Convex `ctx.auth` accepts.
2. **Expand and backfill.**
   - Add the new tables and an optional `workspaceId` with leading indexes.
   - The backfill is rerunnable. It creates the ownerless legacy workspace, tags rows, registers assets, imports the `MCP_TOKEN` hash as a grant, and rebuilds `postStats`.
   - Reads stay singleton-based during this phase.
   - Rehearse the backfill and a restore on an exported copy.
3. **Contract and access.**
   - Drain in-flight publishes first.
   - Keep signup private during cutover. Verify the original owner's app identity and run `bindLegacyOwner`. Incidental signup or a client-supplied profile ID cannot claim existing records.
   - Require workspace ownership after row and job inventory checks pass. Verify the schema deployment sequence in the migration rehearsal.
   - Replace `withSecret`. Remove global shared-secret authorization and the Threads-identity session after live callers have moved. Keep the imported legacy MCP credential scoped to the original workspace.
4. **Routes, onboarding, time:** route split, connect flow, DST rules, additive MCP fields.
5. **Demo:** views, `DemoStore`, CSP `connect-src 'self'`, import-graph test, parity test.
6. **Lifecycle and launch:**
   - Disconnect and delete flows, and the signed Meta uninstall/delete callbacks.
   - Staging checks pass. Advertise only verified channels, then open signup.

## Migration and lifecycle

- **No claiming by connection.** Connecting the legacy Threads ID from another workspace fails the uniqueness rule. `bindLegacyOwner` refuses if the user already owns a non-empty workspace.
- **No silent fallback.** A job whose post has no workspace holds the post and raises an alert. It never falls back to the owner.
- **Sign out** ends the session. Scheduled posts still publish, and the UI says so.
- **Disconnect** deletes the token and keeps the remote ID. Posts become `held{auth}` when they fire. Reconnecting the same profile releases them. A different profile requires Remove channel first.
- **In flight:** recheck the attempt and connection before every new platform dispatch, including each Threads part. Disconnect blocks further sends. A dispatched request can still succeed; retain its receipt or unknown outcome for the same attempt. Unknown LinkedIn outcomes still need confirmation. This does not guarantee exactly-once publication.
- **Delete** marks the workspace `deleting`, which fences access and jobs, then cleans up rows, blobs, grants, and the user. The cleanup resumes if interrupted. Users are told beforehand that remote posts stay up.

## Acceptance scenarios

1. **Isolation sweep:** call private APIs through web, direct backend access, and MCP as user B with user A's record IDs, storage IDs, batch IDs, and reply parents. Foreign rows remain inaccessible. An agent grant resolves only its issuing workspace and rejects another workspace's targets. Invalid and revoked grants fail.
2. **Schema test:** every table is on the global list, or has `workspaceId` with a leading index.
3. **Demo:**
   - Imports of live Convex clients, generated APIs, credentials, or server publishing modules fail the import-graph test. Shared pure domain helpers remain allowed.
   - Only same-origin static requests are made.
   - It works with Convex env unset and loads no private layout data.
4. **Migration:**
   - A second backfill run patches 0 rows.
   - Row counts and pending job IDs/times match before and after.
   - The legacy grant still works.
5. **Jobs:** disconnect between thread parts, using a fake transport and once on staging.
   - The post holds and keeps its partial IDs.
   - After reconnect, only the remaining parts publish.
   - Results with a stale `startedAt` are discarded.
   - Unknown LinkedIn outcomes stay held.
6. **DST:** America/New_York on 2026-03-08 and 2026-11-01. Owner slots don't change.
7. **External tester:** a non-owner publishes on each advertised channel. Permalinks resolve, and owner counts don't change.
8. **Deletion and revocation:** deletion removes tenant data, credentials, and blobs, and cancels pending jobs. Retained scheduler history cannot access a deleted workspace. A revoked grant fails.

## Alternative decision

B's guest backend is a **separate deployment**, not anonymous access to production.

- **Gains:** worker and upload fidelity, credential isolation.
- **Costs:** a second deployment, a guest issuer, quotas, expiry cleanup, and a packaging and transport boundary to verify.

The browser demo avoids anonymous backend writes. It loses background-worker, live-upload, agent, and multi-device fidelity. Shared domain helpers and a parity test limit drift. Revisit if observed demo usage shows those losses matter.

## Sources, gaps, platform unknowns

**From the record:**
- The PRD (`369a173`) excluded multiple accounts from v1.
- `4c06792` added first-connect claiming. The reason is unknown, so the rule is replaceable.
- `3c07faa` added reconnect holds.
- PR #3 (unreviewed) requires separate channels and confirmation of unknown LinkedIn outcomes.

**Gaps:** no PRs for `4c06792` or `3c07faa`. No issue, chat, observability, error, or analytics sources. Production counts unknown.

**Platform status and references:**
- Meta approval status and timing for Threads.
- LinkedIn lists Share on LinkedIn (`w_member_social`) as a self-service consumer permission in its official access documentation. Documentation is verified; actual enabled products, a second member's consent and publishing, and token-refresh behavior remain unchecked. https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access
- Convex documents verified caller identity inside backend functions through `ctx.auth.getUserIdentity()`. Auth vendor and SvelteKit server-token compatibility need the implementation spike. https://docs.convex.dev/auth/functions-auth
- Threads rate limits under per-user fan-out.
- If Threads isn't approved by launch, the user chooses between delaying and launching with Threads shown as unavailable. No quiet invite-only substitute.

**Grafted:**
- From A: route groups, shared views, import-graph/CSP checks, parity test, derived table test, API sweep, grant import, cron fan-out.
- From B: admin binding, OAuth state binding, foreign-reference checks, DST rules, drain/restore, receipt/unknown handling, per-channel gating.

**Rejected:**
- From A: `ScopedDb`, auto-claim, exactly-once, the breaking `wib` change, a workspace-level time zone.
- From B: the second deployment and a mandatory extra connection version before a dispatch design is proven. Keep disconnect checks and preserve already-dispatched results. Select media-delivery details after auditing storage URL exposure.
