<script lang="ts">
	import { page } from '$app/state';
	import Icon, { type IconName } from './Icon.svelte';

	const tabs: { href: string; label: string; icon: IconName; badge?: 'drafts' | 'replies' }[] = [
		{ href: '/', label: 'Drafts', icon: 'drafts', badge: 'drafts' },
		{ href: '/schedule', label: 'Schedule', icon: 'schedule' },
		{ href: '/compose', label: 'New', icon: 'plus' },
		{ href: '/replies', label: 'Replies', icon: 'replies', badge: 'replies' },
		{ href: '/library', label: 'Library', icon: 'library' }
	];
	const badges = $derived((page.data.badges ?? {}) as Record<string, number>);
	const active = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

<nav aria-label="Main">
	{#each tabs as tab}
		{@const count = tab.badge ? badges[tab.badge] : 0}
		<a
			href={tab.href}
			class:compose={tab.icon === 'plus'}
			aria-current={active(tab.href) ? 'page' : undefined}
		>
			<span class="icon">
				<Icon name={tab.icon} size={tab.icon === 'plus' ? 22 : 24} stroke={active(tab.href) ? 2.25 : 1.75} />
				{#if count}<b class="badge num">{count > 999 ? '999+' : count}</b>{/if}
			</span>
			<span class={tab.icon === 'plus' ? 'sr-only' : 'label'}>{tab.label}</span>
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

	a {
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
