<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import TabBar from '#lib/components/TabBar.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	const composing = $derived(page.url.pathname.startsWith('/compose'));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#101010" media="(prefers-color-scheme: dark)" />
</svelte:head>

<div class="app" class:composing>
	{@render children()}
</div>
{#if !composing}<TabBar />{/if}
<Toasts />

<style>
	.app {
		max-width: 600px;
		min-height: 100dvh;
		margin: 0 auto;
		padding-bottom: calc(var(--tabs) + var(--safe-b) + 24px);
	}

	.app.composing {
		padding-bottom: 0;
	}

	@media (min-width: 640px) {
		.app {
			border-inline: 1px solid var(--line);
		}
	}
</style>
