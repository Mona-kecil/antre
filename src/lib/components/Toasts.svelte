<script lang="ts">
	import { dismiss, post, toasts } from '#lib/toast.svelte.ts';
	import Icon from './Icon.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
	{#each toasts as item (item.id)}
		<div class="toast" class:error={item.error}>
			{#if item.error}<Icon name="alert" size={16} />{/if}
			<span>{item.text}</span>
			{#if item.undo}
				{@const undo = item.undo}
				<button
					type="button"
					onclick={() => {
						dismiss(item.id);
						post(undo.action, undo.fields);
					}}>Undo</button
				>
			{/if}
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(var(--tabs) + var(--safe-b) + 12px);
		z-index: 20;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 0 16px;
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: 568px;
		min-height: 44px;
		padding: 10px 16px;
		border-radius: 12px;
		background: var(--fg);
		color: var(--on-fg);
		font-size: 15px;
		line-height: 20px;
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.2);
		pointer-events: auto;
		transition:
			transform 320ms var(--ease),
			opacity 320ms var(--ease);
	}

	@starting-style {
		.toast {
			transform: translateY(12px) scale(0.98);
			opacity: 0;
		}
	}

	.toast.error {
		background: var(--red);
		color: #fff;
	}

	button {
		margin-left: 4px;
		padding: 4px 0;
		font-weight: 700;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
