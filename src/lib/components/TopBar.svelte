<script lang="ts">
	import type { Snippet } from 'svelte';
	import { usePlace } from '#lib/place.svelte.ts';
	import ChannelSwitch from './ChannelSwitch.svelte';

	// The public home nests the bar under its own h1, so it asks for a lower heading.
	let {
		title,
		heading = 'h1',
		lead,
		children
	}: { title: string; heading?: 'h1' | 'h2'; lead?: Snippet; children?: Snippet } = $props();
	const place = usePlace();
</script>

<header class="bar">
	{@render lead?.()}
	<svelte:element this={heading} class="title">{title}</svelte:element>
	<div class="end">
		{#if !place.url.pathname.endsWith('/compose')}<span class="channel"><ChannelSwitch /></span>{/if}{@render children?.()}
	</div>
</header>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 4px;
		height: var(--bar);
		padding: 0 8px 0 16px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}

	.title {
		flex: 1;
		font-size: 20px;
		line-height: 24px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.end {
		display: flex;
		align-items: center;
	}

	.channel {
		display: contents;
	}

	@media (min-width: 1100px) {
		.bar {
			height: 64px;
			padding: 0 16px 0 24px;
		}

		.title {
			font-size: 24px;
			line-height: 30px;
		}

		.channel {
			display: none;
		}
	}
</style>
