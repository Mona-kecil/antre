<script lang="ts">
	import { calendarDay } from '#lib/calendar.ts';
	import { clock, dayLabel, isoDay, slots, when } from '#lib/displayTime.svelte.ts';
	import { DAY } from '#lib/time.ts';
	import Flag from '../components/Flag.svelte';
	import Icon from '../components/Icon.svelte';
	import Labels from '../components/Labels.svelte';
	import Post from '../components/Post.svelte';
	import Sheet from '../components/Sheet.svelte';
	import TopBar from '../components/TopBar.svelte';
	import { names } from './fixtures';
	import MoreSheet from './MoreSheet.svelte';
	import { href, type Sandbox } from './sandbox.svelte';
	import type { DemoPost, DemoStore } from './store';
	import TimeSheet from './TimeSheet.svelte';

	type Planned = DemoPost & { status: Exclude<DemoPost['status'], { kind: 'draft' }> };

	let { sandbox }: { sandbox: Sandbox } = $props();
	const channel = $derived(sandbox.route.channel);
	const tz = $derived(sandbox.settings.timeZone);
	const day = $derived(sandbox.day);
	const today = $derived(sandbox.today);
	const now = $derived(sandbox.now);
	const week = $derived(Array.from({ length: 7 }, (_, i) => calendarDay(sandbox.week.from, i, tz)));
	const planned = $derived(
		sandbox.posts.filter((post): post is Planned => post.status.kind !== 'draft').toSorted((a, b) => a.status.at - b.status.at)
	);
	const within = (post: Planned, from: number) => post.status.at >= from && post.status.at < calendarDay(from, 1, tz);
	const posts = $derived(planned.filter((post) => within(post, day)));
	const published = $derived(posts.filter((post) => post.status.kind === 'published'));
	const queued = $derived(posts.filter((post) => post.status.kind === 'queued'));
	// From today on, published posts fold into one row so the list opens on what is still to come.
	const foldable = $derived(published.length > 0 && day >= today);
	const selected = $derived(/^#post-(.+)$/.exec(sandbox.url.hash)?.[1] ?? null);
	let openDay = $state<number | null>(null);
	const folded = $derived(foldable && openDay !== day && !published.some((post) => post.id === selected));
	const shown = $derived(folded ? posts.filter((post) => post.status.kind !== 'published') : posts);
	const views = $derived(published.reduce((sum, post) => sum + (post.metrics?.views ?? 0), 0));
	const free = $derived(slots(day, sandbox.settings).filter((at) => at > now && !posts.some((post) => post.status.kind !== 'failed' && post.status.at === at)));

	let target = $state<string | null>(null);
	let moving = $state(false);
	let swapping = $state(false);
	let more = $state(false);
	const targetPost = $derived(posts.find((post) => post.id === target));

	const dayHref = (at: number) => href(channel, 'schedule', at === today ? {} : { day: isoDay(at) });

	function open(id: string, sheet: 'move' | 'swap' | 'more') {
		target = id;
		if (sheet === 'move') moving = true;
		if (sheet === 'swap') swapping = true;
		if (sheet === 'more') more = true;
	}

	function on(operation: (store: DemoStore, id: string) => string) {
		const id = target;
		return !!id && sandbox.act((store) => operation(store, id));
	}

	function place(id: string, at: number, verb: string) {
		sandbox.arrived(id);
		return `${verb} ${when(at, now)}`;
	}
</script>

<TopBar title="Schedule" heading="h2">
	{#if day !== today}
		<a class="today" href={href(channel, 'schedule')}>Today</a>
	{/if}
	<a class="icon-btn" href={href(channel, 'settings')} aria-label="Settings"><Icon name="settings" /></a>
</TopBar>

<nav class="week" aria-label="Days">
	<a class="icon-btn" href={dayHref(calendarDay(day, -7, tz))} aria-label="Previous week"><Icon name="left" /></a>
	{#each week as at}
		{@const count = planned.filter((post) => within(post, at)).length}
		<a class="day" href={dayHref(at)} aria-current={at === day ? 'date' : undefined} class:today={at === today} class:past={at < today}>
			<span class="dow">{dayLabel(at).slice(0, 2)}</span>
			<span class="date num">{dayLabel(at).split(' ')[1]}</span>
			<span class="count num" aria-label="{count} posts">{count || '–'}</span>
		</a>
	{/each}
	<a class="icon-btn" href={dayHref(calendarDay(day, 7, tz))} aria-label="Next week"><Icon name="right" /></a>
</nav>

<div class="summary">
	<h3>{day === today ? 'Today' : dayLabel(day)}</h3>
	<p class="muted num">
		{posts.length}
		{posts.length === 1 ? 'post' : 'posts'}
		{#if free.length}· {free.length} free{/if}
		{#if sandbox.nextSlot}· next free {sandbox.nextSlot - day < DAY && sandbox.nextSlot >= day ? clock(sandbox.nextSlot) : when(sandbox.nextSlot, now)}{/if}
	</p>
</div>

{#if foldable}
	<button type="button" class="fold" aria-expanded={!folded} onclick={() => (openDay = folded ? day : null)}>
		<span class="fold-icon"><Icon name="check" size={18} /></span>
		<span class="fold-text">
			<strong class="num">{published.length} published</strong>
			<span class="muted num">
				{clock(published[0].status.at)}{published.length > 1 ? `–${clock(published[published.length - 1].status.at)}` : ''}{#if views}
					· {views.toLocaleString('en')} views{/if}
			</span>
		</span>
		<span class="fold-action">{folded ? 'Show' : 'Hide'}<Icon name="down" size={16} /></span>
	</button>
{/if}

{#each shown as post (post.id)}
	{@const kind = post.status.kind}
	<Post parts={post.parts} username={names[channel]} id="post-{post.id}" selected={post.id === selected}>
		{#snippet head()}
			<time class="time num" datetime={new Date(post.status.at).toISOString()}>{clock(post.status.at)}</time>
			{#if kind === 'failed'}<Flag icon="alert" tone="red" text="Failed" />{/if}
			{#if kind === 'published'}<Flag icon="check" tone="green" text="Published" />{/if}
		{/snippet}
		{#snippet sub()}
			<Labels meta={post.meta} />
			{#if post.status.kind === 'failed'}<p class="error">{post.status.reason}</p>{/if}
		{/snippet}
		{#if kind === 'queued'}
			<button type="button" class="act" onclick={() => open(post.id, 'move')}><Icon name="move" size={18} />Move</button>
			{#if queued.length > 1}
				<button type="button" class="act" onclick={() => open(post.id, 'swap')}><Icon name="swap" size={18} />Swap</button>
			{/if}
			<button type="button" class="act" onclick={() => sandbox.act((store) => (store.unqueue(post.id), 'Moved to drafts'))}>
				<Icon name="drafts" size={18} />Unqueue
			</button>
		{:else if kind === 'failed'}
			<button type="button" class="act" onclick={() => sandbox.act((store) => place(post.id, store.retry(post.id), 'Queued for'))}>
				<Icon name="undo" size={18} />Retry
			</button>
		{:else if post.metrics}
			<span class="metrics num">{post.metrics.views.toLocaleString('en')} views · {post.metrics.likes} likes</span>
		{/if}
		{#if kind !== 'published'}
			<button type="button" class="act more" aria-label="More actions" onclick={() => open(post.id, 'more')}>
				<Icon name="more" size={18} />
			</button>
		{/if}
	</Post>
{:else}
	<div class="empty">
		<p><strong>{published.length ? 'Nothing left on this day.' : 'Nothing on this day.'}</strong></p>
		<p class="muted">
			{free.length
				? `${free.length} free slots. Queue drafts to fill them.`
				: published.length
					? sandbox.nextSlot
						? `Next free slot: ${when(sandbox.nextSlot, now)}.`
						: 'No free slots left.'
					: 'No posting window falls on this day.'}
		</p>
		<a class="btn btn-secondary" href={href(channel, 'drafts')}>Go to drafts</a>
	</div>
{/each}

<TimeSheet
	bind:open={moving}
	title="Move"
	{now}
	nextSlot={sandbox.nextSlot}
	{free}
	at={targetPost?.status.at ?? null}
	onpick={(at) =>
		on((store, id) => (at === 'next' ? place(id, store.queue(id), 'Moved to') : (store.schedule(id, at), place(id, at, 'Moved to'))))}
/>

<Sheet bind:open={swapping} title="Swap times">
	{#if targetPost}
		<p class="muted swap-hint">Trade {clock(targetPost.status.at)} with another queued post on {dayLabel(day)}.</p>
		<ul class="swap">
			{#each queued.filter((post) => post.id !== target) as other (other.id)}
				<li>
					<button
						type="button"
						onclick={() => {
							if (on((store, id) => (store.swap(id, other.id), 'Swapped'))) swapping = false;
						}}
					>
						<time class="num">{clock(other.status.at)}</time>
						<span class="swap-text">{other.parts[0]?.text}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</Sheet>

<MoreSheet
	bind:open={more}
	{channel}
	onpublish={() => on((store, id) => (store.publish(id), 'Published'))}
	ondelete={() => on((store, id) => (store.remove(id), 'Deleted'))}
/>

<style>
	.today {
		margin-right: 4px;
		padding: 6px 10px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
	}

	.today:hover {
		background: var(--press);
	}

	.week {
		display: grid;
		grid-template-columns: 36px repeat(7, 1fr) 36px;
		align-items: center;
		gap: 2px;
		padding: 8px 4px;
		border-bottom: 1px solid var(--line);
	}

	.day {
		display: grid;
		justify-items: center;
		gap: 1px;
		padding: 6px 0;
		border-radius: 12px;
		text-decoration: none;
		transition:
			background-color 160ms var(--ease),
			transform 160ms var(--ease);
	}

	.day:active {
		transform: scale(0.94);
	}

	.dow {
		font-size: 11px;
		line-height: 14px;
		color: var(--fg-2);
	}

	.date {
		font-size: 17px;
		line-height: 22px;
		font-weight: 600;
	}

	.count {
		font-size: 11px;
		line-height: 14px;
		color: var(--fg-2);
	}

	.day.past .date {
		color: var(--fg-2);
		font-weight: 400;
	}

	.day.today .dow {
		color: var(--red);
		font-weight: 600;
	}

	.day[aria-current='date'] {
		background: var(--primary);
	}

	.day[aria-current='date'] * {
		color: var(--on-primary) !important;
	}

	.summary {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 14px 16px 4px;
	}

	.summary h3 {
		font-size: 17px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.summary p {
		font-size: 13px;
	}

	.time {
		font-weight: 600;
	}

	.fold {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 52px;
		padding: 8px 16px;
		text-align: left;
		border-bottom: 1px solid var(--line);
		transition: background-color 160ms var(--ease);
	}

	.fold:hover {
		background: var(--press);
	}

	.fold-icon {
		display: grid;
		place-items: center;
		width: 36px;
		color: var(--green);
	}

	.fold-text {
		display: grid;
		flex: 1;
		font-size: 13px;
		line-height: 18px;
	}

	.fold-text strong {
		font-size: 15px;
		font-weight: 600;
		line-height: 20px;
	}

	.fold-action {
		display: flex;
		align-items: center;
		gap: 2px;
		font-size: 13px;
		font-weight: 500;
		color: var(--fg-2);
	}

	.fold-action :global(svg) {
		transition: transform 200ms var(--ease);
	}

	.fold[aria-expanded='true'] .fold-action :global(svg) {
		transform: rotate(180deg);
	}

	.error {
		margin-top: 4px;
		font-size: 13px;
		line-height: 18px;
		color: var(--red);
	}

	.metrics {
		font-size: 12px;
		color: var(--fg-2);
	}

	.more {
		margin-left: auto !important;
		margin-right: -10px;
		color: var(--fg-2);
	}

	.empty {
		display: grid;
		justify-items: center;
		gap: 4px;
		padding: 48px 32px;
		text-align: center;
	}

	.empty .btn {
		margin-top: 16px;
	}

	.swap-hint {
		margin-bottom: 8px;
		font-size: 13px;
	}

	.swap {
		margin: 0 -16px;
		padding: 0;
		list-style: none;
	}

	.swap button {
		display: grid;
		grid-template-columns: 48px 1fr;
		gap: 8px;
		width: 100%;
		padding: 12px 16px;
		text-align: left;
		border-top: 1px solid var(--line);
	}

	.swap button:hover {
		background: var(--press);
	}

	.swap time {
		font-weight: 600;
	}

	.swap-text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 21px;
	}

	/* The desktop week grid and agenda already show the week and the day. */
	@media (min-width: 1100px) {
		.week,
		.summary {
			display: none;
		}
	}
</style>
