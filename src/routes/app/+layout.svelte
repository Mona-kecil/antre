<script lang="ts">
	import { navigating, page } from '$app/state';
	import TabBar from '#lib/components/TabBar.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	const composing = $derived(page.url.pathname === '/app/compose' || page.url.pathname === '/app/linkedin/compose');
	const pending = $derived(navigating.to !== null);
</script>

{#if pending}
	<div class="navigation-progress" role="progressbar" aria-label="Loading page">
		<span></span>
	</div>
{/if}
<div class="app" class:composing aria-busy={pending}>
	{@render children()}
</div>
{#if !composing && page.url.pathname !== '/app/onboarding'}<TabBar />{/if}
<Toasts />

<style>
	.navigation-progress {
		position: fixed;
		top: env(safe-area-inset-top, 0px);
		left: 0;
		right: 0;
		z-index: 20;
		height: 3px;
		background: var(--line);
		overflow: hidden;
		pointer-events: none;
	}

	.navigation-progress span {
		display: block;
		width: 30%;
		height: 100%;
		background: var(--fg);
		animation: progress 1s linear infinite;
	}

	@keyframes progress {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(350%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.navigation-progress span {
			width: 100%;
			animation: none;
		}
	}

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
