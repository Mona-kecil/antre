<script lang="ts">
	import { navigating, page } from '$app/state';
	import Agenda from '#lib/components/Agenda.svelte';
	import Sidebar from '#lib/components/Sidebar.svelte';
	import TabBar from '#lib/components/TabBar.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const composing = $derived(page.url.pathname === '/app/compose' || page.url.pathname === '/app/linkedin/compose');
	const onboarding = $derived(page.url.pathname === '/app/onboarding');
	const pending = $derived(navigating.to !== null);
	// Re-read the clock whenever fresh data arrives.
	const now = $derived.by(() => {
		void data.week;
		return Date.now();
	});
	let card = $state<HTMLElement>();

	function escape(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !composing || !card || card.querySelector('dialog[open]')) return;
		if (getComputedStyle(card).position !== 'relative') return;
		card.querySelector<HTMLAnchorElement>('header a')?.click();
	}
</script>

<svelte:window onkeydown={escape} />

{#if pending}
	<div class="navigation-progress" role="progressbar" aria-label="Loading page">
		<span></span>
	</div>
{/if}
<div class="shell" class:bare={onboarding}>
	{#if !onboarding}
		<div class="rail side"><Sidebar week={data.week} {now} /></div>
	{/if}
	<div class="app" class:composing aria-busy={pending}>
		<div class="card" bind:this={card}>{@render children()}</div>
	</div>
	{#if !onboarding}
		<div class="rail panel"><Agenda week={data.week} {now} /></div>
	{/if}
</div>
{#if !composing && !onboarding}<div class="tabs"><TabBar /></div>{/if}
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

	.rail {
		display: none;
	}

	@media (min-width: 1100px) {
		.shell:not(.bare) {
			display: grid;
			grid-template-columns: 248px minmax(0, 1fr) 320px;
			background: var(--canvas);
		}

		.rail {
			display: block;
			position: sticky;
			top: 0;
			height: 100dvh;
			overflow: auto;
			scrollbar-width: thin;
		}

		.side {
			grid-column: 1;
			grid-row: 1;
			border-right: 1px solid var(--line);
		}

		.panel {
			grid-column: 3;
			grid-row: 1;
			padding: 22px 18px;
			border-left: 1px solid var(--line);
		}

		.shell:not(.bare) .app {
			grid-column: 2;
			grid-row: 1;
			width: 100%;
			max-width: none;
			padding-bottom: 40px;
			border: 0;
			background: var(--bg);
		}

		.shell:not(.bare) .app > .card {
			max-width: 680px;
			margin: 0 auto;
		}

		.tabs {
			display: none;
		}

		.shell:not(.bare) .app.composing {
			position: fixed;
			inset: 0;
			z-index: 30;
			display: grid;
			place-items: center;
			padding: 24px;
			background: rgb(0 0 0 / 0.42);
		}

		.shell:not(.bare) .app.composing > .card {
			position: relative;
			width: min(640px, 100%);
			max-height: calc(100dvh - 48px);
			margin: 0;
			overflow: auto;
			border-radius: 20px;
			background: var(--bg);
			box-shadow: 0 24px 64px rgb(0 0 0 / 0.28);
		}

		.app.composing > .card :global(.composer) {
			min-height: 0;
		}
	}
</style>
