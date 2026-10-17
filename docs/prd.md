# Antre: a tiny Typefully for one Threads account

Working name "antre" (Indonesian for queue). Status: plan, no code yet. Date: 2026-10-18.

## Why

Typefully's free plan caps scheduling at 10 posts a month. One batch from `drafts/` is 17 posts. We need a tool that drafts and schedules without a cap, for one account, and that an AI agent can fill directly.

## What v1 does

1. **Connect Threads.** One OAuth flow connects the account and also logs you in. Only your Threads user id is allowed in.
2. **Draft.** Write a post as one or more parts. More than one part publishes as a thread, each part replying to the one before. Each part has a 500-character counter and an optional image.
3. **Queue.** "Add to queue" puts the post in the next free slot. You can also pick an exact time, publish now, or pull a post back to drafts.
4. **Publish.** At the slot time the post goes out. The queue shows each post as draft, queued, publishing, published (with a link), or failed (with the reason and a retry button).
5. **Agent access over MCP.** Claude Code or Codex can list the queue, create drafts, and queue them, so a batch like `drafts/2026-10-16-T01` goes in with one prompt.

Not in v1: insights, more than one account, carousels and video, writing posts with AI inside the app, recurring posts, team features.

## Queue slots

Every 30 minutes from 06:00 to 12:00 WIB (Asia/Jakarta), every day. That is 13 slots a day. A batch bigger than 13 spills into the next day.

Why this window. Buffer's Feb 2026 study of 2.5M Threads posts found weekday mornings from 06:00 to 11:00 local time get the most engagement. The top slots were Thursday 09:00, then Wednesday 12:00 and 09:00. Evenings (18:00 to 23:00) did worst, and weekends were weaker, Saturday most of all. Buffer reports viewer local time, so the hours apply to WIB as is.
Source: https://buffer.com/resources/the-best-time-to-post-on-threads/ (read 2026-10-18).

Confidence is low to medium. No Indonesia-specific Threads timing data turned up, and Buffer does not say which countries its sample covers. The window lives in settings, so we change it once our own numbers come in.

## Data shape

One `posts` table. Status is a tagged union, so a post is in exactly one state:

```ts
type Part = { text: string /* <= 500 chars */; imageId?: Id<"_storage"> };

type Status =
  | { kind: "draft" }
  | { kind: "queued"; at: number; jobId: Id<"_scheduled_functions"> }
  | { kind: "publishing"; at: number; startedAt: number }
  | { kind: "published"; at: number; permalink: string }
  | { kind: "failed"; at: number; error: string };

type Post = {
  parts: Part[];            // 1..n; n > 1 publishes as a reply chain
  publishedIds: string[];   // Threads id of each part already live, in order
  status: Status;
  meta?: { topic?: string; angle?: string; format?: string }; // tracker.csv codes
  source: "web" | "agent";
};
```

Plus two single-row tables:
- `settings` holds the timezone, window start, window end, and interval.
- `account` holds the Threads user id, username, token, token expiry, and whether it needs reconnecting.

Slots are not stored. A slot is free when no queued, publishing, or published post sits at that time. Convex mutations are serializable, so two queue calls cannot grab the same slot.

## How publishing works

Threads has no API for scheduling. Convex holds the queue and calls Threads when a slot comes due.

1. Queuing a post saves it and schedules `fire(postId)` at the slot time in the same transaction.
2. `fire` is a mutation. It moves the post from queued to publishing and starts the `publish` action. If the post is no longer queued, `fire` does nothing.
3. `publish` starts at `parts[publishedIds.length]`. For each remaining part it creates a container, sets `reply_to_id` to the previous part's id after the first, publishes the container, and saves the new id right away.
4. When every part is live, the post becomes published. Any error makes it failed, with the message shown.
5. Retry runs the same `publish`. Parts already live are skipped, so a half-posted thread picks up where it stopped.

Duplicates are the main risk. Convex runs an action at most once and never retries it. Threads' publish call has no idempotency key. If a publish call times out, Meta may have posted the part anyway. Before retrying that part, check the account's latest posts for the same text, and adopt the id if it is there.

A cron runs every 10 minutes and marks any post stuck in publishing for over 10 minutes as failed. A dead action then shows up as a retryable failure, not a post stuck forever.

Another cron refreshes the 60-day token once a week. If Threads rejects the token (error 190), the account is flagged and a "reconnect" banner appears. Queued posts fail with a clear reason, not silently.

## Agent access (MCP)

Built on the latest MCP spec, dated 2026-07-28, using the official TypeScript SDK v2 that implements it.

- **Server.** A SvelteKit route at `/mcp` on Vercel, built with `mcp-handler` 2.x over Streamable HTTP. It calls Convex from the server side.
- **Auth.** A long random bearer token kept in a Vercel env var. Claude Code and Codex both support bearer headers for remote MCP servers. Full OAuth can come later if anyone else ever uses this.
- **Tools.**
  - `list_queue(days?)`
  - `create_draft(parts, meta?)`
  - `update_draft(id, parts?, meta?)`
  - `queue(id, at?)`, which takes the next free slot when `at` is missing
  - `unqueue(id)`
  - `publish_now(id)`
  - `delete_post(id)`

A CLI comes free. `npx convex run` calls the same functions, which covers scripting without extra code.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Scheduling | Convex `scheduler.runAt` | Vercel Hobby cron runs at most once a day. Convex jobs are free at this volume, since 13 jobs a day is about 400 calls a month against a 1M allowance. |
| Images | Convex file storage | `getUrl` returns a public URL, which is what Threads needs to fetch the image. |
| UI + MCP | SvelteKit on Vercel | You asked for this stack. `mcp-handler` 2.x supports SvelteKit. |
| Login | Threads OAuth, owner id allowlist | One flow both connects the account and logs you in. No second auth system. |
| Convex access | Server-side only, shared secret | The browser never calls Convex directly. That keeps the token safe. The cost is no live updates, so the page refreshes on navigation. |

## Phases

Each phase ends in something you can check on the real account.

0. **Spike (half a day).** Create the Meta app with the Threads use case and add yourself as tester. Get a token, then post a 2-part thread to your account with `curl` and delete it. This also confirms the facts the research could not reach on Meta's docs: rate limits, token refresh, and how a tester gets access.
1. **Skeleton.** SvelteKit plus Convex, deployed to Vercel. Threads login works on the production URL, since Threads OAuth needs HTTPS and does not accept localhost. Check: you log in and the app shows your username.
2. **Drafts and publish now.** The editor, image upload, and the publish action. Check: a 3-part thread with an image goes out from the UI.
3. **Queue.** Slots, `fire`, the stuck-post cron, retry, and the token cron. Check: queue 3 posts into the next slots and they go out on time. Kill one publish partway through and confirm retry finishes it without a duplicate.
4. **MCP.** Check: Claude Code connects, imports the Bahasa batch from `posts.id.csv`, and queues it.
5. **Later.** Pull insights into the app so `tracker.csv` fills itself. Then retune the slot window from your own numbers.

## Risks and unknowns

- **Meta's docs were unreachable during research** because of rate limiting. The API facts come from Meta's official Postman collection and sample app, plus one secondary guide. The 250 posts a day limit and the token rules are confirmed in Phase 0.
- **Meta access.** Standard access should be enough when you are the app owner or a tester. If Meta asks for app review anyway, Phase 0 shows it on day one.
- **Posting time.** The window rests on global data. Treat it as a starting guess.
- **Convex timing precision** is not documented. Expect seconds of drift, not minutes. Phase 3 measures it.
