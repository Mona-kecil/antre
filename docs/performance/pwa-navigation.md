# PWA navigation verification

On 2026-10-19, the installed production app reproduced a delayed Drafts-to-Schedule switch in an iPhone 17 simulator running iOS 26.5. One recording showed about 1.7 seconds from the tap marker to the heading change. That sample does not establish physical-iPhone latency.

## Controlled comparison

Both sides used production builds, the same local Convex backend, and the same account and draft fixture. The baseline was `3ce1e9c`. A loopback proxy added 150 ms before each Convex request. Both builds used that proxy. This measures behavior under a specified network cost, not production latency.

The iOS home screen app loaded both builds through the same origin. Five runs per side alternated baseline and candidate. Each run reloaded Drafts, waited for the installed app to confirm readiness, then tapped Schedule. Warmup runs were excluded. One earlier pilot navigation was interrupted by the harness switching builds before completion. The final cohort waited for completion before every switch.

A page probe measured the click event through the first animation frame with the destination URL and selected tab. SvelteKit can start data preloading on touchstart before that click event. The same measurement applied to both sides. The probe captured HTTP statuses, the destination heading, standalone mode, and the first busy-state mutation. Backend traces counted the queries inside each route-data request.

| Pair | Baseline navigation, ms | Candidate navigation, ms | Candidate feedback, ms |
| --- | ---: | ---: | ---: |
| 1 | 531 | 163 | 15 |
| 2 | 320 | 95 | 16 |
| 3 | 367 | 84 | 17 |
| 4 | 262 | 289 | 16 |
| 5 | 269 | 71 | 16 |

Median navigation was 320 ms before and 95 ms after. The ranges were 262 to 531 ms and 71 to 289 ms. All ten requests returned 200 and displayed Schedule. The baseline had no pending indicator. Candidate feedback had a 16 ms median and a 15 to 17 ms range.

Each baseline Schedule data request made `account.current`, then `posts.schedule`. Each candidate request made only `posts.schedule`. The injected request delay explains the saved serial wait. Runtime noise and eager code loading also affect the whole navigation measurement, so the 225 ms median difference cannot be attributed to the owner query alone. One candidate run was slower than its paired baseline. Production improvement remains unmeasured until deployment.

## Behavior and authorization

With an additional 900 ms route-data delay, the installed candidate showed a pending Schedule marker and progress below the status area. The page probe in that stress run recorded feedback at 45 ms and destination completion at 1,257 ms. This stress run is separate from the comparison cohort.

Browser checks confirmed that the displayed route keeps `aria-current` during loading. Completion, rapid replacement navigation, Back, and an injected data-load error cleared the pending markers, progress indicator, and busy state. Every main-nav link had eager code preloading. Existing touch data preloading remains enabled.

The final test run passed 110 tests across 13 files. `npm run check` reported zero errors and warnings. Production builds and `git diff --check` passed. Ownership tests cover absent and mismatched identities in each concurrent read, the selected Compose edit row, fresh checks after account removal, sanitized responses, and authorization before writes. An independent final source review found no remaining defect.

## Rollout

Deploy the additive Convex response change before the web app. The new read loaders require `replies.list` to return its sanitized account. The old web app can ignore that new field. Deploying the new web app against the old Convex response would reject affected loads.

Keep authorization checks on writes and keep authenticated responses as `no-store`. This patch adds no service worker data cache or authorization cache. Settings retains its existing owner lookup.

After deployment, repeat the installed-PWA check against production. Capture fresh cold and repeat navigation samples on the target iPhone before making a production latency claim.
