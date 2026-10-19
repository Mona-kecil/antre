<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Snippet } from 'svelte';
	import { act } from '#lib/toast.svelte.ts';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';

	let {
		open = $bindable(false),
		id,
		canPublish = true,
		canDelete = true,
		children
	}: {
		open?: boolean;
		id: string | null;
		canPublish?: boolean;
		canDelete?: boolean;
		children?: Snippet;
	} = $props();
	let confirming = $state<'now' | 'delete' | null>(null);
	const done = act(() => (open = false));

	$effect(() => {
		if (!open) confirming = null;
	});
</script>

<Sheet bind:open title={confirming === 'now' ? 'Publish now?' : confirming === 'delete' ? 'Delete post?' : 'Post'}>
	{#if id}
		{#if confirming}
			<p class="muted confirm">
				{confirming === 'now'
					? 'This posts to Threads immediately, skipping the queue.'
					: 'The post and its images are removed. This can’t be undone.'}
			</p>
			<form method="POST" action="?/post" use:enhance={done} class="stack">
				<input type="hidden" name="id" value={id} />
				<input type="hidden" name="operation" value={confirming} />
				<button class="btn btn-block {confirming === 'now' ? 'btn-primary' : 'btn-danger'}">
					{confirming === 'now' ? 'Publish now' : 'Delete'}
				</button>
				<button type="button" class="btn btn-secondary btn-block" onclick={() => (confirming = null)}>
					Cancel
				</button>
			</form>
		{:else}
			<ul class="menu">
				{@render children?.()}
				{#if canPublish}
					<li>
						<button type="button" onclick={() => (confirming = 'now')}>
							<Icon name="send" />Publish now
						</button>
					</li>
				{/if}
				{#if canDelete}
					<li>
						<button type="button" class="danger" onclick={() => (confirming = 'delete')}>
							<Icon name="trash" />Delete
						</button>
					</li>
				{/if}
			</ul>
		{/if}
	{/if}
</Sheet>

<style>
	.confirm {
		margin-bottom: 16px;
	}

	.stack {
		display: grid;
		gap: 8px;
	}

	.menu {
		margin: 0 -16px;
		padding: 0;
		list-style: none;
	}

	.menu :global(li > button),
	.menu :global(li > a),
	.menu :global(li > form > button) {
		display: flex;
		align-items: center;
		gap: 14px;
		width: 100%;
		min-height: 52px;
		padding: 0 16px;
		font-size: 15px;
		font-weight: 500;
		text-align: left;
		text-decoration: none;
	}

	.menu :global(li > button:hover),
	.menu :global(li > a:hover),
	.menu :global(li > form > button:hover) {
		background: var(--press);
	}

	.danger {
		color: var(--red);
	}
</style>
