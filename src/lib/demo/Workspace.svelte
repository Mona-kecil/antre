<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { providePlace } from '#lib/place.svelte.ts';
	import Agenda from '../components/Agenda.svelte';
	import Sidebar from '../components/Sidebar.svelte';
	import TabBar from '../components/TabBar.svelte';
	import Compose from './Compose.svelte';
	import Drafts from './Drafts.svelte';
	import Library from './Library.svelte';
	import Replies from './Replies.svelte';
	import { Sandbox } from './sandbox.svelte';
	import Schedule from './Schedule.svelte';
	import Settings from './Settings.svelte';

	const sandbox = new Sandbox(page.url.origin);
	providePlace({
		get url() {
			return sandbox.url;
		},
		get badges() {
			return sandbox.badges;
		}
	});
	const views = { drafts: Drafts, schedule: Schedule, library: Library, replies: Replies, compose: Compose, settings: Settings };
	const View = $derived(views[sandbox.route.name]);
	const composing = $derived(sandbox.route.name === 'compose');
	// Forms seed from the URL once, so a new URL starts them over; lists keep their sheets.
	const key = $derived(
		composing || sandbox.route.name === 'settings' ? sandbox.url.pathname + sandbox.url.search : sandbox.route.name
	);
	let shell = $state<HTMLElement>();
	const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Every /app link inside the sample moves the sample instead of the page.
	async function follow(event: MouseEvent) {
		const link = (event.target as Element).closest('a');
		if (!link || link.origin !== location.origin || !/^\/app(\/|$)/.test(link.pathname)) return;
		event.preventDefault();
		sandbox.go(link.href);
		await tick();
		if (!shell) return;
		const top = shell.getBoundingClientRect().top;
		if (top < 0) shell.scrollIntoView({ behavior: still() ? 'auto' : 'smooth' });
		const id = sandbox.url.hash.slice(1);
		if (id) shell.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
	}

	function escape(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !composing || !shell || shell.querySelector('dialog[open]')) return;
		shell.querySelector<HTMLAnchorElement>('.page header a')?.click();
	}

	// The slot a post just took: its agenda row and week cell catch the eye once.
	$effect(() => {
		const fresh = sandbox.fresh;
		if (!fresh || !shell || still()) return;
		const root = shell;
		tick().then(() => {
			for (const target of root.querySelectorAll(`a[href$="#post-${CSS.escape(fresh.id)}"]`))
				target.animate([{ background: 'var(--primary)', transform: 'scale(1.06)' }, {}], {
					duration: 1400,
					easing: 'cubic-bezier(0.23, 1, 0.32, 1)'
				});
		});
	});
</script>

<svelte:window onkeydown={escape} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<section id="sample" class="shell" aria-label="Sample workspace" bind:this={shell} onclickcapture={follow}>
	<div class="rail side"><Sidebar week={sandbox.week} now={sandbox.now} /></div>
	<div class="page" class:composing>
		<div class="card">
			{#key key}<View {sandbox} />{/key}
		</div>
		<div class="toasts" role="status" aria-live="polite">
			{#if sandbox.toast}
				{#key sandbox.toast.id}
					<div class="toast" class:error={sandbox.toast.error}>{sandbox.toast.text}</div>
				{/key}
			{/if}
		</div>
		{#if !composing}<div class="tabs"><TabBar /></div>{/if}
	</div>
	<div class="rail panel"><Agenda week={sandbox.week} now={sandbox.now} /></div>
</section>

<style>
	/* The app's own shell, scoped to a section of the home page. */
	.shell {
		position: relative;
		border-block: 1px solid var(--line);
	}

	.rail {
		display: none;
	}

	.page {
		display: flex;
		flex-direction: column;
		max-width: 600px;
		min-height: 640px;
		margin: 0 auto;
		background: var(--bg);
	}

	.card {
		display: flex;
		flex-direction: column;
		flex: 1;
	}

	.card > :global(*) {
		width: 100%;
	}

	.card > :global(.composer) {
		flex: 1;
	}

	/* The app's toast, kept inside the sample so it stays beside the post that changed. */
	.toasts {
		position: sticky;
		z-index: 6;
		bottom: calc(var(--tabs) + 20px);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		height: 0;
		padding: 0 16px;
		pointer-events: none;
	}

	.composing .toasts {
		bottom: 84px;
	}

	.toast {
		min-height: 44px;
		padding: 12px 16px;
		border-radius: 12px;
		background: var(--fg);
		color: var(--on-fg);
		font-size: 15px;
		line-height: 20px;
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.2);
		transition:
			transform 320ms var(--ease),
			opacity 320ms var(--ease);
	}

	.toast.error {
		background: var(--red);
		color: #fff;
	}

	@starting-style {
		.toast {
			transform: translateY(12px) scale(0.98);
			opacity: 0;
		}
	}

	/* The app's tab bar is fixed to the viewport; containment pins it to the foot of the sample. */
	.tabs {
		height: calc(var(--tabs) + var(--safe-b));
		contain: layout;
	}

	@media (min-width: 640px) {
		.page {
			border-inline: 1px solid var(--line);
		}
	}

	@media (min-width: 1100px) {
		.shell {
			display: grid;
			grid-template-columns: 248px minmax(0, 1fr) 320px;
			background: var(--canvas);
		}

		.rail {
			display: block;
		}

		.side {
			grid-column: 1;
			grid-row: 1;
			display: flex;
			flex-direction: column;
			border-right: 1px solid var(--line);
		}

		.side > :global(.side) {
			flex: 1;
		}

		/* The masthead already carries the wordmark. */
		.side :global(.brand) {
			display: none;
		}

		.panel {
			grid-column: 3;
			grid-row: 1;
			padding: 22px 18px;
			border-left: 1px solid var(--line);
		}

		.page {
			grid-column: 2;
			grid-row: 1;
			width: 100%;
			max-width: none;
			min-height: 760px;
			border: 0;
		}

		.card {
			width: 100%;
			max-width: 680px;
			margin-inline: auto;
		}

		.tabs {
			display: none;
		}

		/* Composing opens over the whole sample, the way it opens over the app. */
		.page.composing::before {
			content: '';
			position: absolute;
			inset: 0;
			z-index: 30;
			background: rgb(0 0 0 / 0.42);
		}

		.composing > .card {
			position: absolute;
			top: 50%;
			left: 50%;
			z-index: 31;
			flex: none;
			width: min(640px, 100% - 48px);
			max-height: calc(100% - 48px);
			overflow: auto;
			border-radius: 20px;
			background: var(--bg);
			box-shadow: 0 24px 64px rgb(0 0 0 / 0.28);
			translate: -50% -50%;
		}

		.composing .toasts {
			position: absolute;
			z-index: 32;
			inset: auto 0 40px;
		}
	}
</style>
