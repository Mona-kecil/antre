<script lang="ts">
	import { page } from '$app/state';
	import Icon from './Icon.svelte';

	let {
		total,
		offset,
		limit,
		noun = 'posts'
	}: { total: number; offset: number; limit: number; noun?: string } = $props();
	const current = $derived(Math.floor(offset / limit) + 1);
	const last = $derived(Math.max(1, Math.ceil(total / limit)));

	function href(to: number) {
		const url = new URL(page.url.href);
		if (to <= 1) url.searchParams.delete('page');
		else url.searchParams.set('page', String(to));
		return url.pathname + url.search;
	}
</script>

<div class="pager">
	<p class="num">
		{#if total === 0}
			No {noun}
		{:else if total <= limit}
			{total} {total === 1 ? noun.replace(/s$/, '') : noun}
		{:else}
			{offset + 1}–{Math.min(offset + limit, total)} of {total}
		{/if}
	</p>
	{#if last > 1}
		<div class="nav">
			{#if current > 1}
				<a class="icon-btn" href={href(current - 1)} aria-label="Previous page"><Icon name="left" /></a>
			{:else}
				<span class="icon-btn off" aria-hidden="true"><Icon name="left" /></span>
			{/if}
			<span class="num muted">{current}/{last}</span>
			{#if current < last}
				<a class="icon-btn" href={href(current + 1)} aria-label="Next page"><Icon name="right" /></a>
			{:else}
				<span class="icon-btn off" aria-hidden="true"><Icon name="right" /></span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.pager {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 52px;
		padding: 0 8px 0 16px;
		font-size: 13px;
		color: var(--fg-2);
	}

	.nav {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.off {
		opacity: 0.3;
	}
</style>
