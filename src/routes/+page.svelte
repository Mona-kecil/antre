<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { needsImage } from '#lib/labels.ts';
	import { act } from '#lib/toast.svelte.ts';
	import { ago, when } from '#lib/time.ts';
	import Flag from '#lib/components/Flag.svelte';
	import FilterBar from '#lib/components/FilterBar.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Labels from '#lib/components/Labels.svelte';
	import MoreSheet from '#lib/components/MoreSheet.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import Post from '#lib/components/Post.svelte';
	import TimeSheet from '#lib/components/TimeSheet.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const username = $derived(data.account?.username ?? 'you');
	const filtered = $derived(
		['topic', 'angle', 'format', 'q'].some((key) => page.url.searchParams.has(key))
	);
	let target = $state<string | null>(null);
	let scheduling = $state(false);
	let more = $state(false);
	let opened = $state<Record<string, boolean>>({});
	const now = Date.now();

	function viewHref(view: 'drafts' | 'failed') {
		return view === 'failed' ? '/?view=failed' : '/';
	}
</script>

<svelte:head><title>Drafts · antre</title></svelte:head>

<TopBar title="Drafts">
	<a class="icon-btn" href="/settings" aria-label="Settings"><Icon name="settings" /></a>
</TopBar>

{#if data.counts.failed || data.view === 'failed'}
	<nav class="views" aria-label="Draft views">
		<a href={viewHref('drafts')} aria-current={data.view === 'drafts' ? 'page' : undefined}>
			Drafts <span class="num">{data.counts.drafts}</span>
		</a>
		<a href={viewHref('failed')} aria-current={data.view === 'failed' ? 'page' : undefined}>
			Failed <span class="num">{data.counts.failed}</span>
		</a>
	</nav>
{/if}

<FilterBar facets={data.facets} />

{#each data.items as item (item.id)}
	{@const failed = item.status.kind === 'failed' ? item.status : null}
	<Post parts={item.parts} {username} id="post-{item.id}">
		{#snippet head()}
			<time class="muted" datetime={new Date(item._creationTime).toISOString()}>{ago(item._creationTime, now)}</time>
			{#if item.source === 'agent'}<span class="muted">· agent</span>{/if}
		{/snippet}
		{#snippet sub()}
			<Labels meta={item.meta}>
				{#if needsImage(item.meta, item.parts)}<Flag icon="image" tone="amber" text="Image needed" />{/if}
			</Labels>
			{#if item.meta.notes}
				<button
					type="button"
					class="notes"
					class:open={opened[item.id]}
					aria-expanded={!!opened[item.id]}
					onclick={() => (opened[item.id] = !opened[item.id])}
				>
					<Icon name="note" size={13} stroke={2} /><span>{item.meta.notes}</span>
				</button>
			{/if}
			{#if failed}
				<p class="error"><Icon name="alert" size={14} stroke={2} />{failed.error} · was {when(failed.at, now)}</p>
			{/if}
		{/snippet}
		{#if failed}
			<form method="POST" action="?/post" use:enhance={act()}>
				<input type="hidden" name="id" value={item.id} />
				<input type="hidden" name="operation" value="retry" />
				<button class="act"><Icon name="undo" size={18} />Retry</button>
			</form>
		{:else}
			<form method="POST" action="?/post" use:enhance={act()}>
				<input type="hidden" name="id" value={item.id} />
				<input type="hidden" name="operation" value="queue" />
				<button class="act"><Icon name="queue" size={18} />Queue</button>
			</form>
		{/if}
		<button
			type="button"
			class="act"
			onclick={() => {
				target = item.id;
				scheduling = true;
			}}><Icon name="clock" size={18} />{failed ? 'Requeue' : 'Schedule'}</button
		>
		<a class="act" href="/compose?edit={item.id}"><Icon name="edit" size={18} />Edit</a>
		<button
			type="button"
			class="act more"
			aria-label="More actions"
			onclick={() => {
				target = item.id;
				more = true;
			}}><Icon name="more" size={18} /></button
		>
	</Post>
{:else}
	<div class="empty">
		{#if filtered}
			<p><strong>Nothing matches these filters.</strong></p>
			<p class="muted">Try another tag or clear the search.</p>
			<a class="btn btn-secondary" href={data.view === 'failed' ? '/?view=failed' : '/'}>Clear filters</a>
		{:else if data.view === 'failed'}
			<p><strong>No failed posts.</strong></p>
			<p class="muted">Posts that Threads rejects land here to retry.</p>
		{:else}
			<p><strong>No drafts yet.</strong></p>
			<p class="muted">Drafts from your agent appear here for review.</p>
			<a class="btn btn-primary" href="/compose">Write a post</a>
		{/if}
	</div>
{/each}

{#if data.total}
	<Pager total={data.total} offset={data.offset} limit={data.limit} noun={data.view === 'failed' ? 'failed posts' : 'drafts'} />
{/if}

<TimeSheet bind:open={scheduling} id={target} operation="queue" nextSlot={data.nextSlot} />
<MoreSheet bind:open={more} id={target} />

<style>
	.views {
		display: flex;
		gap: 20px;
		padding: 0 16px;
		border-bottom: 1px solid var(--line);
	}

	.views a {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 44px;
		margin-bottom: -1px;
		color: var(--fg-2);
		font-weight: 600;
		text-decoration: none;
		border-bottom: 1.5px solid transparent;
	}

	.views a[aria-current='page'] {
		color: var(--fg);
		border-color: var(--fg);
	}

	.views .num {
		font-size: 13px;
		font-weight: 400;
		color: var(--fg-2);
	}

	.notes {
		display: flex;
		gap: 6px;
		margin-top: 2px;
		padding: 2px 0;
		text-align: left;
		font-size: 12px;
		line-height: 17px;
		color: var(--fg-2);
	}

	.notes :global(.icon) {
		margin-top: 2px;
		color: var(--fg-3);
	}

	.notes span {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		overflow: hidden;
		white-space: pre-wrap;
	}

	.notes.open span {
		display: block;
	}

	.error {
		display: flex;
		gap: 6px;
		margin-top: 4px;
		font-size: 13px;
		line-height: 18px;
		color: var(--red);
	}

	.error :global(svg) {
		flex: none;
		margin-top: 2px;
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
		padding: 64px 32px;
		text-align: center;
	}

	.empty .btn {
		margin-top: 16px;
	}
</style>
