<script lang="ts">
	import { navigating, page } from '$app/state';
	import { isCurrent, isLinkedIn, navItems } from '#lib/nav.ts';
	import Icon from './Icon.svelte';

	const linkedin = $derived(isLinkedIn(page.url));
	const tabs = $derived(navItems(page.url));
	const badges = $derived((page.data.badges ?? {}) as Record<string, number>);
</script>

<nav aria-label="Main" class:linkedin>
	{#each tabs as tab}
		{@const count = tab.badge ? badges[tab.badge] : 0}
		{@const active = isCurrent(page.url, tab.href)}
		{@const pending = isCurrent(navigating.to?.url, tab.href)}
		<a
			href={tab.href}
			data-sveltekit-preload-code="eager"
			class:compose={tab.icon === 'plus'}
			class:pending
			aria-current={active ? 'page' : undefined}
		>
			<span class="pending-marker" aria-hidden="true"></span>
			<span class="icon">
				<Icon
					name={tab.icon}
					size={tab.icon === 'plus' ? 22 : 24}
					stroke={active ? 2.25 : 1.75}
				/>
				{#if count}<b class="badge num">{count > 999 ? '999+' : count}</b>{/if}
			</span>
			<span class={tab.icon === 'plus' ? 'sr-only' : 'label'}>{tab.label}</span>
			{#if pending}<span class="sr-only">Loading</span>{/if}
		</a>
	{/each}
</nav>

<style>
	nav {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 10;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		max-width: 600px;
		margin: 0 auto;
		height: calc(var(--tabs) + var(--safe-b));
		padding: 0 4px var(--safe-b);
		background: var(--bg);
		border-top: 1px solid var(--line);
	}

	nav.linkedin {
		grid-template-columns: repeat(4, 1fr);
	}

	a {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		color: var(--fg-2);
		text-decoration: none;
		transition:
			color 160ms var(--ease),
			transform 160ms var(--ease);
	}

	a:active {
		transform: scale(0.92);
	}

	a[aria-current='page'] {
		color: var(--fg);
	}

	.pending-marker {
		position: absolute;
		top: 5px;
		left: 50%;
		width: 18px;
		height: 3px;
		border-radius: 2px;
		background: var(--fg);
		transform: translateX(-50%);
		opacity: 0;
	}

	.pending .pending-marker {
		opacity: 1;
	}

	.icon {
		position: relative;
	}

	.compose .icon {
		display: grid;
		place-items: center;
		width: 52px;
		height: 38px;
		border-radius: 10px;
		background: var(--bg-2);
		color: var(--fg-2);
	}

	.compose[aria-current='page'] .icon {
		color: var(--fg);
	}

	.label {
		font-size: 10px;
		line-height: 12px;
		font-weight: 500;
	}

	.badge {
		position: absolute;
		top: -4px;
		left: 15px;
		min-width: 18px;
		height: 16px;
		padding: 0 5px;
		border-radius: 8px;
		background: var(--fg);
		color: var(--on-fg);
		box-shadow: 0 0 0 2px var(--bg);
		font-size: 10px;
		line-height: 16px;
		font-weight: 700;
		text-align: center;
	}

	@media (prefers-color-scheme: dark) {
		a {
			color: var(--fg-2);
		}
	}
</style>
