# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One account owner reviews drafts and schedules posts, including drafts created by an agent through MCP.

## Product Purpose

Antre holds drafts for review and publishes approved posts at chosen times.

## Operating Context

The app runs on SvelteKit and Convex, with a Vercel deployment at https://antre-hazel.vercel.app. Existing app access belongs to one Threads account.

## Capabilities and Constraints

- Threads supports multipart posts, images, a publishing queue, replies, and a library.
- LinkedIn targets the owner's personal profile. Its content is mostly distinct from Threads content and does not inherit the owner's marketing topics.
- The first LinkedIn release covers text drafts, review, and scheduling.
- Each channel keeps its own drafts, topics, posting schedule, and connection state.
- LinkedIn company Pages, engagement analytics, and a replies inbox are outside this release.
- The owner has authorized setup of the LinkedIn integration. A custom domain is not required.

## Open Decisions

The owner has not specified LinkedIn topics or a writing style. Do not seed marketing topics or infer a content strategy.
