<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fade, slide } from 'svelte/transition';
	import { ago, when } from '#lib/displayTime.svelte.ts';
	import Icon from '../components/Icon.svelte';
	import Labels from '../components/Labels.svelte';
	import Post from '../components/Post.svelte';
	import TopBar from '../components/TopBar.svelte';
	import { names } from './fixtures';
	import MoreSheet from './MoreSheet.svelte';
	import { href, type Sandbox } from './sandbox.svelte';
	import type { DemoStore } from './store';
	import TimeSheet from './TimeSheet.svelte';

	let { sandbox }: { sandbox: Sandbox } = $props();
	const channel = $derived(sandbox.route.channel);
	const failedView = $derived(sandbox.url.searchParams.get('view') === 'failed');
	const failed = $derived(sandbox.posts.filter((post) => post.status.kind === 'failed'));
	const items = $derived(
		(failedView ? failed : sandbox.posts.filter((post) => post.status.kind === 'draft')).toSorted(
			(a, b) => b.createdAt - a.createdAt
		)
	);
	let opened = $state<Record<string, boolean>>({});
	let target = $state<string | null>(null);
	let scheduling = $state(false);
	let more = $state(false);

	function take(id: string, place: (store: DemoStore) => number, verb = 'Queued') {
		return sandbox.act((store) => {
			const at = place(store);
			sandbox.arrived(id);
			return `${verb} for ${when(at, sandbox.now)}`;
		});
	}

	function on(operation: (store: DemoStore, id: string) => string) {
		const id = target;
		return !!id && sandbox.act((store) => operation(store, id));
	}

	function schedule(at: number | 'next') {
		const id = target;
		return !!id && take(id, (store) => (at === 'next' ? store.queue(id) : (store.schedule(id, at), at)), 'Scheduled');
	}
</script>

<TopBar title="Drafts" heading="h2">
	<a class="icon-btn" href={href(channel, 'settings')} aria-label="Settings"><Icon name="settings" /></a>
</TopBar>

{#if failed.length || failedView}
	<nav class="views" aria-label="Draft views">
		<a href={href(channel, 'drafts')} aria-current={failedView ? undefined : 'page'}>
			Drafts <span class="num">{sandbox.badges.drafts}</span>
		</a>
		<a href={href(channel, 'drafts', { view: 'failed' })} aria-current={failedView ? 'page' : undefined}>
			Failed <span class="num">{failed.length}</span>
		</a>
	</nav>
{/if}

{#each items as item (item.id)}
	{@const error = item.status.kind === 'failed' ? item.status : null}
	<div animate:flip={{ duration: 320 }} out:slide={{ duration: 280 }}>
		<Post parts={item.parts} username={names[channel]} id="post-{item.id}">
			{#snippet head()}
				<time class="muted" datetime={new Date(item.createdAt).toISOString()}>{ago(item.createdAt, sandbox.now)}</time>
				{#if item.source === 'agent'}<span class="muted">· agent</span>{/if}
			{/snippet}
			{#snippet sub()}
				<Labels meta={item.meta} />
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
				{#if error}
					<p class="error"><Icon name="alert" size={14} stroke={2} />{error.reason} · was {when(error.at, sandbox.now)}</p>
				{/if}
			{/snippet}
			{#if error}
				<button type="button" class="act" onclick={() => take(item.id, (store) => store.retry(item.id))}>
					<Icon name="undo" size={18} />Retry
				</button>
			{:else}
				<button type="button" class="act" onclick={() => take(item.id, (store) => store.queue(item.id))}>
					<Icon name="queue" size={18} />Queue
				</button>
			{/if}
			<button
				type="button"
				class="act"
				onclick={() => {
					target = item.id;
					scheduling = true;
				}}><Icon name="clock" size={18} />{error ? 'Requeue' : 'Schedule'}</button
			>
			<a class="act" href={href(channel, 'compose', { edit: item.id })}><Icon name="edit" size={18} />Edit</a>
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
	</div>
{:else}
	<div class="empty" in:fade={{ delay: 280, duration: 200 }}>
		{#if failedView}
			<p><strong>No failed posts.</strong></p>
			<p class="muted">Posts that {channel === 'threads' ? 'Threads' : 'LinkedIn'} rejects land here to retry.</p>
		{:else}
			<p><strong>No drafts left.</strong></p>
			<p class="muted">Each one has a time on the schedule.</p>
			<div class="calls">
				<a class="btn btn-primary" href={href(channel, 'compose')}>Write a post</a>
				<button type="button" class="btn btn-secondary" onclick={() => sandbox.reset()}>Reset sample</button>
			</div>
		{/if}
	</div>
{/each}

<TimeSheet
	bind:open={scheduling}
	title="Schedule"
	now={sandbox.now}
	nextSlot={sandbox.nextSlot}
	onpick={schedule}
/>
<MoreSheet
	bind:open={more}
	{channel}
	onpublish={() => on((store, id) => (store.publish(id), 'Published'))}
	ondelete={() => on((store, id) => (store.remove(id), 'Deleted'))}
/>

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
		padding: 96px 32px;
		text-align: center;
	}

	.calls {
		display: flex;
		gap: 8px;
		margin-top: 16px;
	}
</style>
