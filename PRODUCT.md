# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People review drafts and schedule posts to their own Threads account and personal LinkedIn profile. Visitors can explore a synthetic demo without an account. Each signed-in user owns a private workspace and can grant an agent access through MCP.

## Product Purpose

Antre holds drafts for review and publishes approved posts at chosen times.

## Operating Context

SvelteKit serves the public site, demo, and private app. Convex stores workspace data and runs publishing jobs. WorkOS AuthKit supplies app login. Threads and LinkedIn OAuth connect publishing profiles after login. The existing Vercel deployment is https://antre.monosodiums.com; this branch's public release still needs deployment and provider access checks.

## Capabilities and Constraints

- Threads supports multipart posts, images, a publishing queue, replies, and a library.
- LinkedIn targets a personal profile. Its drafts and writing preferences stay separate from Threads.
- The first LinkedIn release covers text drafts, review, and scheduling.
- Each channel keeps its own drafts, topics, posting schedule, and connection state.
- LinkedIn company Pages, engagement analytics, and a replies inbox are outside this release.
- Public pages live at `/` and `/demo`. Private pages live under `/app`.
- The demo stores synthetic data in the current browser and never publishes to a platform.
- Workspaces own their posts, media, settings, connection tokens, and agent grants. Signing out leaves queued jobs running. Disconnecting a channel blocks new dispatches until that profile reconnects.
- New workspaces choose an IANA timezone. The legacy workspace retains Asia/Jakarta and its queued UTC timestamps.

## Open Decisions

Threads and LinkedIn public access must be checked with a non-owner account before launch. Do not claim approval from source configuration alone. New users choose their own topics and writing preferences.
