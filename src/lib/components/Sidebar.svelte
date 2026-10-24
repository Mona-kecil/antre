<script lang="ts">
	import { navigating, page } from '$app/state';
	import { isCurrent, isLinkedIn, navItems } from '#lib/nav.ts';
	import type { Week } from '#lib/week.ts';
	import ChannelSwitch from './ChannelSwitch.svelte';
	import Icon from './Icon.svelte';
	import WeekGrid from './WeekGrid.svelte';

	let { week, now }: { week: Week; now: number } = $props();
	const items = $derived(navItems(page.url));
	const compose = $derived(items.find((item) => item.icon === 'plus')!);
	const badges = $derived((page.data.badges ?? {}) as Record<string, number>);
	const linkedin = $derived(isLinkedIn(page.url));
	const name = $derived(
		linkedin ? (page.data.connection?.name ?? 'LinkedIn') : (page.data.account?.username ?? 'you')
	);
</script>

<aside class="side" aria-label="Workspace">
	<a class="brand" href="/app"><span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>antre</a>
	<ChannelSwitch />
	<nav aria-label="Views">
		{#each items as item}
			{#if item !== compose}
				{@const count = item.badge ? badges[item.badge] : 0}
				<a
					href={item.href}
					class:pending={isCurrent(navigating.to?.url, item.href)}
					aria-current={isCurrent(page.url, item.href) ? 'page' : undefined}
				>
					<Icon name={item.icon} size={18} />
					{item.label}
					{#if count}<span class="count num">{count > 999 ? '999+' : count}</span>{/if}
				</a>
			{/if}
		{/each}
	</nav>
	<a class="btn btn-primary new" href={compose.href}><Icon name="plus" size={16} stroke={2} />New post</a>
	<WeekGrid {week} {now} />
	<footer>
		<span class="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
		<span class="who">
			<strong>{name}</strong>
			<span class="muted">{week.settings.timeZone}</span>
		</span>
		<a class="icon-btn" href={linkedin ? '/app/linkedin/settings' : '/app/settings'} aria-label="Settings">
			<Icon name="settings" size={18} />
		</a>
	</footer>
</aside>

<style>
	.side {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 18px 14px;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 8px 4px;
		font-size: 20px;
		font-weight: 650;
		letter-spacing: -0.03em;
		text-decoration: none;
	}

	.mark {
		display: flex;
		align-items: end;
		gap: 2.5px;
		height: 18px;
	}

	.mark i {
		width: 4px;
		height: 10px;
		border-radius: 2px;
		background: currentColor;
	}

	.mark i:nth-child(2) {
		height: 17px;
	}

	.mark i:nth-child(3) {
		height: 13px;
	}

	nav {
		display: grid;
		gap: 2px;
	}

	nav a {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 999px;
		color: var(--fg-2);
		font-weight: 500;
		text-decoration: none;
	}

	nav a:hover {
		background: var(--press);
		color: var(--fg);
	}

	nav a[aria-current='page'] {
		background: var(--bg-2);
		color: var(--fg);
	}

	nav a.pending {
		color: var(--fg);
	}

	.count {
		margin-left: auto;
		font-size: 12px;
	}

	.new {
		width: 100%;
		margin-bottom: 6px;
	}

	footer {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: auto;
		padding: 14px 4px 0;
		border-top: 1px solid var(--line);
		font-size: 12.5px;
		line-height: 1.35;
	}

	.avatar {
		display: grid;
		flex: none;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--primary);
		color: var(--on-primary);
		font-weight: 700;
		font-size: 13px;
	}

	.who {
		display: grid;
		min-width: 0;
		margin-right: auto;
	}

	.who strong,
	.who span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
