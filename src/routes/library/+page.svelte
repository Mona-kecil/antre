<script lang="ts">
	import { page } from '$app/state';
	import { ago } from '#lib/time.ts';
	import FilterBar from '#lib/components/FilterBar.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Labels from '#lib/components/Labels.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import Post from '#lib/components/Post.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const username = $derived(data.account?.username ?? 'you');
	const sorts = [
		{ value: 'date', label: 'Newest' },
		{ value: 'views', label: 'Most viewed' },
		{ value: 'engagement', label: 'Best engagement' }
	] as const;
	const now = Date.now();
	const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

	function sortHref(sort: string) {
		const url = new URL(page.url.href);
		url.searchParams.delete('page');
		if (sort === 'date') url.searchParams.delete('sort');
		else url.searchParams.set('sort', sort);
		return url.pathname + url.search;
	}
</script>

<svelte:head><title>Library · antre</title></svelte:head>

<TopBar title="Library">
	<a class="icon-btn" href="/settings" aria-label="Settings"><Icon name="settings" /></a>
</TopBar>

<FilterBar facets={data.facets} placeholder="Search published posts" />

<nav class="sorts" aria-label="Sort">
	{#each sorts as sort}
		<a href={sortHref(sort.value)} aria-current={data.sort === sort.value ? 'true' : undefined}>{sort.label}</a>
	{/each}
</nav>

{#each data.items as item (item.id)}
	<Post parts={item.parts} topicTag={item.topicTag} {username} id="post-{item.id}">
		{#snippet head()}
			{#if item.at}<time class="muted" datetime={new Date(item.at).toISOString()}>{ago(item.at, now)}</time>{/if}
		{/snippet}
		{#snippet sub()}<Labels meta={item.meta} />{/snippet}
		<p class="metrics num">
			{#if item.metrics}
				<span><b>{compact.format(item.metrics.views)}</b> views</span>
				<span><b>{compact.format(item.metrics.likes)}</b> likes</span>
				<span><b>{compact.format(item.metrics.replies)}</b> replies</span>
				<span><b>{compact.format(item.metrics.reposts + item.metrics.quotes)}</b> reposts</span>
				{#if item.engagement !== null}<span><b>{(item.engagement * 100).toFixed(1)}%</b> eng.</span>{/if}
			{:else}
				<span>No metrics yet</span>
			{/if}
		</p>
		{#if item.status.kind === 'published'}
			<a class="open" href={item.status.permalink} target="_blank" rel="noreferrer" aria-label="Open on Threads">
				<Icon name="external" size={18} />
			</a>
		{/if}
	</Post>
{:else}
	<div class="empty">
		<p><strong>{data.total === 0 && !page.url.search ? 'Nothing published yet.' : 'Nothing matches.'}</strong></p>
		<p class="muted">Published posts and their metrics collect here after each sync.</p>
	</div>
{/each}

{#if data.total}
	<Pager total={data.total} offset={data.offset} limit={data.limit} />
{/if}

<style>
	.sorts {
		display: flex;
		gap: 4px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--line);
		overflow-x: auto;
		scrollbar-width: none;
	}

	.sorts a {
		flex: none;
		padding: 4px 10px;
		border-radius: 8px;
		color: var(--fg-2);
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
	}

	.sorts a[aria-current='true'] {
		background: var(--bg-2);
		color: var(--fg);
	}

	.metrics {
		display: flex;
		flex-wrap: wrap;
		column-gap: 12px;
		row-gap: 2px;
		padding: 4px 0;
		font-size: 12px;
		line-height: 16px;
		color: var(--fg-2);
	}

	.metrics b {
		color: var(--fg);
		font-weight: 600;
	}

	.open {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		margin-left: auto;
		margin-right: -6px;
		border-radius: 50%;
		color: var(--fg-2);
	}

	.open:hover {
		background: var(--press);
	}

	.empty {
		display: grid;
		justify-items: center;
		gap: 4px;
		padding: 64px 32px;
		text-align: center;
	}
</style>
