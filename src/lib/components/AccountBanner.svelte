<script lang="ts">
	import { page } from '$app/state';
	import { dayLabel } from '#lib/time.ts';
	import Icon from './Icon.svelte';

	type Account = {
		needsReconnect: boolean;
		tokenExpiresAt: number;
		lastRefreshError: string | null;
		lastRefreshErrorAt: number | null;
	} | null;
	let { held = 0 }: { held?: number } = $props();
	const account = $derived(page.data.account as Account);
	const expiresSoon = $derived(
		account !== null && account.tokenExpiresAt - Date.now() < 7 * 86_400_000
	);
</script>

{#if account?.needsReconnect}
	<div class="banner red" role="alert">
		<Icon name="alert" size={18} />
		<p>
			<strong>Threads needs reconnecting.</strong>
			{held
				? `${held} ${held === 1 ? 'post is' : 'posts are'} held and go back into the queue when you reconnect.`
				: 'Queued posts will be held until you reconnect.'}
		</p>
		<a class="btn btn-primary" href="/login" data-sveltekit-reload>Reconnect</a>
	</div>
{:else if account && (account.lastRefreshError || expiresSoon)}
	<div class="banner amber" role="status">
		<Icon name="alert" size={18} />
		<p>
			<strong>Threads access ends {dayLabel(account.tokenExpiresAt)}.</strong>
			{account.lastRefreshError
				? `The last automatic refresh failed: ${account.lastRefreshError}`
				: 'Reconnect to keep posting.'}
		</p>
		<a class="btn btn-secondary" href="/login" data-sveltekit-reload>Reconnect</a>
	</div>
{/if}

<style>
	.banner {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: start;
		gap: 10px;
		padding: 12px 16px;
		font-size: 13px;
		line-height: 18px;
		border-bottom: 1px solid var(--line);
	}

	.banner :global(.icon) {
		margin-top: 0;
	}

	.red {
		background: var(--red-bg);
	}

	.red :global(.icon),
	.red strong {
		color: var(--red);
	}

	.amber {
		background: var(--amber-bg);
	}

	.amber :global(.icon),
	.amber strong {
		color: var(--amber);
	}

	strong {
		font-weight: 600;
	}

	.btn {
		height: 32px;
		padding: 0 14px;
		font-size: 13px;
	}
</style>
