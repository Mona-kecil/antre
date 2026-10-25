<script lang="ts">
	import { enhance } from '$app/forms';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { topicColor, type TaxonomyEntry } from '#lib/labels.ts';
	import { act } from '#lib/toast.svelte.ts';
	import { calendarDay } from '#lib/calendar.ts';
	import { DAY, clock, dayLabel, isoDay, slots, when } from '#lib/displayTime.svelte.ts';
	import AccountBanner from '#lib/components/AccountBanner.svelte';
	import DayLine from '#lib/components/DayLine.svelte';
	import Flag from '#lib/components/Flag.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Labels from '#lib/components/Labels.svelte';
	import MoreSheet from '#lib/components/MoreSheet.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import Post from '#lib/components/Post.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import TimeSheet from '#lib/components/TimeSheet.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import type { PageProps } from './$types';

	const LIMIT = 20;
	let { data }: PageProps = $props();
	const taxonomy = $derived((data.taxonomy ?? []) as TaxonomyEntry[]);
	const username = $derived(data.account?.username ?? 'you');
	// Re-read the clock whenever fresh data arrives.
	const now = $derived.by(() => {
		void data.posts;
		return Date.now();
	});
	const week = $derived(Array.from({ length: 7 }, (_, i) => calendarDay(data.from, i, data.settings.timeZone)));
	const published = $derived(data.posts.filter((post) => post.status.kind === 'published'));
	// From today on, published posts fold into one row so the list opens on
	// what is still to come. Past days stay open as a record.
	const foldable = $derived(published.length > 0 && data.day >= data.today);
	let openDay = $state<number | null>(null);
	const folded = $derived(foldable && openDay !== data.day);
	const visible = $derived(
		folded ? data.posts.filter((post) => post.status.kind !== 'published') : data.posts
	);
	const views = $derived(published.reduce((sum, post) => sum + (post.metrics?.views ?? 0), 0));
	const pageNo = $derived(Math.max(1, Number(page.url.searchParams.get('page')) || 1));
	const lastStart = $derived(Math.floor(Math.max(0, visible.length - 1) / LIMIT) * LIMIT);
	const offset = $derived(Math.min((pageNo - 1) * LIMIT, lastStart));
	const shown = $derived(visible.slice(offset, offset + LIMIT));
	const marks = $derived(
		data.posts.map((post) => ({
			id: post.id,
			at: post.at,
			kind: post.status.kind,
			color: topicColor(post.meta.topic, taxonomy)
		}))
	);
	const free = $derived(
		slots(data.day, data.settings).filter(
			(at) =>
				at > now &&
				!data.posts.some(
					(post) =>
						post.at === at &&
						['queued', 'publishing', 'published'].includes(post.status.kind)
				)
		)
	);
	const queued = $derived(data.posts.filter((post) => post.status.kind === 'queued'));

	let selected = $state<string | null>(null);
	let target = $state<string | null>(null);
	let moving = $state(false);
	let swapping = $state(false);
	let more = $state(false);
	const targetPost = $derived(data.posts.find((post) => post.id === target));

	function dayHref(at: number) {
		return at === data.today ? '/app/schedule' : `/app/schedule?day=${isoDay(at)}`;
	}

	async function toPage(wanted: number) {
		if (wanted === pageNo) return;
		const url = new URL(page.url.href);
		if (wanted === 1) url.searchParams.delete('page');
		else url.searchParams.set('page', String(wanted));
		await goto(url, { replace: true, reset: false });
	}

	async function select(id: string) {
		selected = id;
		if (folded && published.some((post) => post.id === id)) openDay = data.day;
		await toPage(Math.floor(visible.findIndex((post) => post.id === id) / LIMIT) + 1);
		await tick();
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		document
			.getElementById(`post-${id}`)
			?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
	}

	// Week grid links arrive as #post-ID; the post may be folded away or on a later page.
	let reached = '';
	afterNavigate(() => {
		const id = /^#post-(.+)$/.exec(page.url.hash)?.[1];
		if (!id || reached === `${data.day}:${id}` || !data.posts.some((post) => post.id === id)) return;
		reached = `${data.day}:${id}`;
		void select(id);
	});

	function open(id: string, sheet: 'move' | 'swap' | 'more') {
		target = id;
		if (sheet === 'move') moving = true;
		if (sheet === 'swap') swapping = true;
		if (sheet === 'more') more = true;
	}
</script>

<svelte:head><title>Schedule · antre</title></svelte:head>

<TopBar title="Schedule">
	{#if data.day !== data.today}
		<a class="today" href="/app/schedule">Today</a>
	{/if}
	<a class="icon-btn" href="/app/settings" aria-label="Settings"><Icon name="settings" /></a>
</TopBar>

<AccountBanner held={data.held} />

<nav class="week" aria-label="Days">
	<a class="icon-btn" href={dayHref(calendarDay(data.day, -7, data.settings.timeZone))} aria-label="Previous week"><Icon name="left" /></a>
	{#each week as at, i}
		{@const count = data.counts[i]}
		<a
			class="day"
			href={dayHref(at)}
			aria-current={at === data.day ? 'date' : undefined}
			class:today={at === data.today}
			class:past={at < data.today}
		>
			<span class="dow">{dayLabel(at).slice(0, 2)}</span>
			<span class="date num">{dayLabel(at).split(' ')[1]}</span>
			<span class="count num" aria-label="{count} posts">{count || '–'}</span>
		</a>
	{/each}
	<a class="icon-btn" href={dayHref(calendarDay(data.day, 7, data.settings.timeZone))} aria-label="Next week"><Icon name="right" /></a>
</nav>

<div class="summary">
	<h2>{data.day === data.today ? 'Today' : dayLabel(data.day)}</h2>
	<p class="muted num">
		{data.posts.length}
		{data.posts.length === 1 ? 'post' : 'posts'}
		{#if free.length}· {free.length} free{/if}
		{#if data.nextSlot}· next free {data.nextSlot - data.day < DAY && data.nextSlot >= data.day
				? clock(data.nextSlot)
				: when(data.nextSlot, now)}{/if}
	</p>
</div>

<DayLine
	day={data.day}
	settings={data.settings}
	posts={marks}
	{now}
	nextSlot={data.nextSlot}
	{selected}
	onselect={select}
/>

{#if foldable}
	<button
		type="button"
		class="fold"
		aria-expanded={!folded}
		onclick={() => {
			openDay = folded ? data.day : null;
			void toPage(1);
		}}
	>
		<span class="fold-icon"><Icon name="check" size={18} /></span>
		<span class="fold-text">
			<strong class="num">{published.length} published</strong>
			<span class="muted num">
				{clock(published[0].at)}{published.length > 1 ? `–${clock(published[published.length - 1].at)}` : ''}{#if views}
					· {views.toLocaleString('en')} views{/if}
			</span>
		</span>
		<span class="fold-action">{folded ? 'Show' : 'Hide'}<Icon name="down" size={16} /></span>
	</button>
{/if}

{#each shown as post (post.id)}
	{@const kind = post.status.kind}
		<Post parts={post.parts} topicTag={post.topicTag} {username} id="post-{post.id}" selected={post.id === selected}>
		{#snippet head()}
			<time class="time num" datetime={new Date(post.at).toISOString()}>{clock(post.at)}</time>
			{#if kind === 'queued' && post.pinned}<Flag icon="pin" tone="indigo" text="Pinned" />{/if}
			{#if kind === 'held'}<Flag icon="alert" tone="amber" text="Held" />{/if}
			{#if kind === 'failed'}<Flag icon="alert" tone="red" text="Failed" />{/if}
			{#if kind === 'publishing'}<Flag icon="send" text="Publishing…" />{/if}
			{#if kind === 'published'}<Flag icon="check" tone="green" text="Published" />{/if}
		{/snippet}
		{#snippet sub()}
			<Labels meta={post.meta} />
			{#if post.status.kind === 'failed'}<p class="error">{post.status.error}</p>{/if}
			{#if post.status.kind === 'held'}<p class="held">{post.status.reason}</p>{/if}
		{/snippet}
		{#if kind === 'queued'}
			<button type="button" class="act" onclick={() => open(post.id, 'move')}><Icon name="move" size={18} />Move</button>
			{#if queued.length > 1}
				<button type="button" class="act" onclick={() => open(post.id, 'swap')}><Icon name="swap" size={18} />Swap</button>
			{/if}
			<form method="POST" action="?/post" use:enhance={act()}>
				<input type="hidden" name="id" value={post.id} />
				<input type="hidden" name="operation" value="unqueue" />
				<button class="act"><Icon name="drafts" size={18} />Unqueue</button>
			</form>
		{:else if kind === 'failed'}
			<form method="POST" action="?/post" use:enhance={act()}>
				<input type="hidden" name="id" value={post.id} />
				<input type="hidden" name="operation" value="retry" />
				<button class="act"><Icon name="undo" size={18} />Retry</button>
			</form>
		{:else if post.status.kind === 'published'}
			<a class="act" href={post.status.permalink} target="_blank" rel="noreferrer"><Icon name="external" size={18} />View on Threads</a>
			{#if post.metrics}
				<span class="metrics num">{post.metrics.views.toLocaleString('en')} views · {post.metrics.likes} likes</span>
			{/if}
		{/if}
		{#if kind === 'queued' || kind === 'held' || kind === 'failed'}
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
					? data.nextSlot
						? `Next free slot: ${when(data.nextSlot, now)}.`
						: 'No free slots left.'
					: 'No posting window falls on this day.'}
		</p>
		<a class="btn btn-secondary" href="/app">Go to drafts</a>
	</div>
{/each}

{#if visible.length > LIMIT}
	<Pager total={visible.length} {offset} limit={LIMIT} />
{/if}

<TimeSheet
	bind:open={moving}
	id={target}
	operation="move"
	nextSlot={data.nextSlot}
	{free}
	at={targetPost?.at ?? null}
/>

<Sheet bind:open={swapping} title="Swap times">
	{#if targetPost}
		<p class="muted swap-hint">
			Trade {clock(targetPost.at)} with another queued post on {dayLabel(data.day)}.
		</p>
		<ul class="swap">
			{#each queued.filter((post) => post.id !== target) as other (other.id)}
				<li>
					<form method="POST" action="?/post" use:enhance={act(() => (swapping = false))}>
						<input type="hidden" name="id" value={targetPost.id} />
						<input type="hidden" name="operation" value="swap" />
						<input type="hidden" name="otherId" value={other.id} />
						<button>
							<time class="num">{clock(other.at)}</time>
							<span class="swap-text">{other.parts[0]?.text}</span>
						</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</Sheet>

<MoreSheet
	bind:open={more}
	id={target}
	canPublish={targetPost?.status.kind !== 'publishing'}
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

	.summary h2 {
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

	.error,
	.held {
		margin-top: 4px;
		font-size: 13px;
		line-height: 18px;
	}

	.error {
		color: var(--red);
	}

	.held {
		color: var(--amber);
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

	/* The desktop week grid and agenda already show the week, the day and its timeline. */
	@media (min-width: 1100px) {
		.week,
		.summary,
		:global(.dayline) {
			display: none;
		}
	}
</style>
