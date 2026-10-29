<script lang="ts">
	import Icon from '../components/Icon.svelte';
	import Sheet from '../components/Sheet.svelte';

	let {
		open = $bindable(false),
		channel,
		onpublish,
		ondelete
	}: {
		open?: boolean;
		channel: 'threads' | 'linkedin';
		onpublish: () => boolean;
		ondelete: () => boolean;
	} = $props();
	let confirming = $state<'now' | 'delete' | null>(null);
	$effect(() => {
		if (!open) confirming = null;
	});
</script>

<Sheet bind:open title={confirming === 'now' ? 'Publish now?' : confirming === 'delete' ? 'Delete post?' : 'Post'}>
	{#if confirming}
		<p class="muted confirm">
			{confirming === 'now'
				? `This posts to ${channel === 'threads' ? 'Threads' : 'LinkedIn'} immediately, skipping the queue.`
				: 'The post and its images are removed. This can’t be undone.'}
		</p>
		<div class="stack">
			<button
				type="button"
				class="btn btn-block {confirming === 'now' ? 'btn-primary' : 'btn-danger'}"
				onclick={() => {
					if ((confirming === 'now' ? onpublish : ondelete)()) open = false;
				}}
			>
				{confirming === 'now' ? 'Publish now' : 'Delete'}
			</button>
			<button type="button" class="btn btn-secondary btn-block" onclick={() => (confirming = null)}>Cancel</button>
		</div>
	{:else}
		<ul class="menu">
			<li>
				<button type="button" onclick={() => (confirming = 'now')}><Icon name="send" />Publish now</button>
			</li>
			<li>
				<button type="button" class="danger" onclick={() => (confirming = 'delete')}><Icon name="trash" />Delete</button>
			</li>
		</ul>
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

	.menu button {
		display: flex;
		align-items: center;
		gap: 14px;
		width: 100%;
		min-height: 52px;
		padding: 0 16px;
		font-size: 15px;
		font-weight: 500;
		text-align: left;
	}

	.menu button:hover {
		background: var(--press);
	}

	.danger {
		color: var(--red);
	}
</style>
