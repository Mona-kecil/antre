<script lang="ts">
	import { ago } from '#lib/displayTime.svelte.ts';
	import Icon from '../components/Icon.svelte';
	import Labels from '../components/Labels.svelte';
	import Post from '../components/Post.svelte';
	import TopBar from '../components/TopBar.svelte';
	import { names } from './fixtures';
	import { href, type Sandbox } from './sandbox.svelte';

	let { sandbox }: { sandbox: Sandbox } = $props();
	const channel = $derived(sandbox.route.channel);
	const sort = $derived(sandbox.url.searchParams.get('sort') === 'views' ? 'views' : 'recent');
	const items = $derived(
		sandbox.posts
			.flatMap((post) => (post.status.kind === 'published' ? [{ ...post, at: post.status.at }] : []))
			.toSorted((a, b) => (sort === 'views' ? (b.metrics?.views ?? 0) - (a.metrics?.views ?? 0) : b.at - a.at))
	);
	const compact = new Intl.NumberFormat('en', { notation: 'compact' });
</script>

<TopBar title="Library" heading="h2">
	<a class="icon-btn" href={href(channel, 'settings')} aria-label="Settings"><Icon name="settings" /></a>
</TopBar>

<nav class="sorts" aria-label="Sort">
	<a href={href(channel, 'library')} aria-current={sort === 'recent' ? 'true' : undefined}>Recent</a>
	<a href={href(channel, 'library', { sort: 'views' })} aria-current={sort === 'views' ? 'true' : undefined}>Most viewed</a>
</nav>

{#each items as item (item.id)}
	<Post parts={item.parts} username={names[channel]} id="post-{item.id}">
		{#snippet head()}
			<time class="muted" datetime={new Date(item.at).toISOString()}>{ago(item.at, sandbox.now)}</time>
		{/snippet}
		{#snippet sub()}<Labels meta={item.meta} />{/snippet}
		<p class="metrics num">
			{#if item.metrics}
				<span><b>{compact.format(item.metrics.views)}</b> views</span>
				<span><b>{compact.format(item.metrics.likes)}</b> likes</span>
				<span><b>{compact.format(item.metrics.replies)}</b> replies</span>
			{:else}
				<span>No metrics yet</span>
			{/if}
		</p>
	</Post>
{:else}
	<div class="empty">
		<p><strong>Nothing published yet.</strong></p>
		<p class="muted">Published posts and their metrics collect here after each sync.</p>
	</div>
{/each}

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

	.empty {
		display: grid;
		justify-items: center;
		gap: 4px;
		padding: 64px 32px;
		text-align: center;
	}
</style>
