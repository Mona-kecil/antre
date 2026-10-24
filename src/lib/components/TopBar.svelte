<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import ChannelSwitch from './ChannelSwitch.svelte';

	let {
		title,
		lead,
		children
	}: { title: string; lead?: Snippet; children?: Snippet } = $props();
</script>

<header class="bar">
	{@render lead?.()}
	<h1>{title}</h1>
	<div class="end">
		{#if !page.url.pathname.endsWith('/compose')}<span class="channel"><ChannelSwitch /></span>{/if}{@render children?.()}
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

	h1 {
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

		h1 {
			font-size: 24px;
			line-height: 30px;
		}

		.channel {
			display: none;
		}
	}
</style>
