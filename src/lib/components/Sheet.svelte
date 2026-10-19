<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		title,
		children
	}: { open?: boolean; title: string; children: Snippet } = $props();
	let dialog: HTMLDialogElement;

	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	class="sheet"
	aria-label={title}
	onclose={() => (open = false)}
	onclick={(event) => {
		if (event.target === dialog) open = false;
	}}
>
	<div class="inner">
		<span class="grab" aria-hidden="true"></span>
		<header>
			<h2>{title}</h2>
			<button type="button" class="icon-btn" aria-label="Close" onclick={() => (open = false)}>
				<Icon name="close" />
			</button>
		</header>
		{#if open}{@render children()}{/if}
	</div>
</dialog>

<style>
	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		width: 100%;
		max-width: 600px;
		max-height: 88dvh;
		margin: 0 auto;
		padding: 0;
		border: 0;
		border-radius: 16px 16px 0 0;
		background: var(--bg-sheet);
		color: var(--fg);
		box-shadow: 0 -8px 40px rgb(0 0 0 / 0.18);
		transform: translateY(100%);
		transition:
			transform 420ms var(--ease-sheet),
			overlay 420ms allow-discrete,
			display 420ms allow-discrete;
	}

	.sheet[open] {
		transform: translateY(0);
	}

	@starting-style {
		.sheet[open] {
			transform: translateY(100%);
		}
	}

	.sheet::backdrop {
		background: rgb(0 0 0 / 0);
		transition:
			background-color 420ms var(--ease-sheet),
			overlay 420ms allow-discrete,
			display 420ms allow-discrete;
	}

	.sheet[open]::backdrop {
		background: rgb(0 0 0 / 0.4);
	}

	@starting-style {
		.sheet[open]::backdrop {
			background: rgb(0 0 0 / 0);
		}
	}

	.inner {
		max-height: 88dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 8px 16px calc(20px + var(--safe-b));
	}

	.grab {
		display: block;
		width: 36px;
		height: 5px;
		margin: 0 auto 4px;
		border-radius: 3px;
		background: var(--line-2);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin: 0 -8px 8px 0;
	}

	h2 {
		font-size: 17px;
		line-height: 22px;
		font-weight: 600;
	}
</style>
