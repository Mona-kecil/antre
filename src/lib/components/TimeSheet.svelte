<script lang="ts">
	import { enhance } from '$app/forms';
	import { act } from '#lib/toast.svelte.ts';
	import { clock, localInput, when, timeZone } from '#lib/displayTime.svelte.ts';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';

	let {
		open = $bindable(false),
		id,
		operation,
		nextSlot,
		free = [],
		at = null
	}: {
		open?: boolean;
		id: string | null;
		operation: 'queue' | 'move';
		nextSlot: number | null;
		free?: number[];
		at?: number | null;
	} = $props();
	const done = act(() => (open = false));
	const now = $derived(Date.now());
</script>

<Sheet bind:open title={operation === 'queue' ? 'Schedule' : 'Move'}>
	{#if id}
		{#if at}<p class="muted now-at">Now {when(at)}</p>{/if}
		{#if nextSlot}
			<form method="POST" action="?/post" use:enhance={done}>
				<input type="hidden" name="id" value={id} />
				<input type="hidden" name="operation" value={operation} />
				<button class="row">
					<Icon name="queue" />
					<span>
						<strong>Next free slot</strong>
						<span class="muted">{when(nextSlot, now)}</span>
					</span>
				</button>
			</form>
		{/if}
		{#if free.length}
			<p class="label">Free on this day</p>
			<div class="chips">
				{#each free as slot}
					<form method="POST" action="?/post" use:enhance={done}>
						<input type="hidden" name="id" value={id} />
						<input type="hidden" name="operation" value={operation} />
						<input type="hidden" name="slot" value={slot} />
						<button class="chip num">{clock(slot)}</button>
					</form>
				{/each}
			</div>
		{/if}
		<form method="POST" action="?/post" use:enhance={done} class="pick">
			<input type="hidden" name="id" value={id} />
			<input type="hidden" name="operation" value={operation} />
			<label class="label" for="when-{id}">Pick a time <span class="muted">· {timeZone()}</span></label>
			<input
				id="when-{id}"
				class="field"
				type="datetime-local"
				name="at"
				required
				min={localInput(now)}
				value={localInput(at && at > now ? at : (nextSlot ?? now + 3_600_000))}
			/>
			<button class="btn btn-primary btn-block">
				{operation === 'queue' ? 'Schedule' : 'Move here'}
			</button>
			<p class="muted hint">A picked time stays put when the queue reflows.</p>
		</form>
	{/if}
</Sheet>

<style>
	.now-at {
		margin: -4px 0 8px;
		font-size: 13px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: calc(100% + 32px);
		min-height: 56px;
		margin: 0 -16px;
		padding: 0 16px;
		text-align: left;
	}

	.row:hover {
		background: var(--press);
	}

	.row > span {
		display: flex;
		flex-direction: column;
	}

	.row strong {
		font-weight: 600;
	}

	.row .muted {
		font-size: 13px;
	}

	.label {
		display: block;
		margin: 16px 0 8px;
		font-size: 13px;
		font-weight: 600;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		height: 32px;
		padding: 0 12px;
		border-radius: 8px;
		border: 1px solid var(--line-2);
		font-size: 13px;
		font-weight: 500;
		transition: transform 160ms var(--ease);
	}

	.chip:active {
		transform: scale(0.95);
	}

	.pick .field {
		margin-bottom: 12px;
	}

	.hint {
		margin-top: 8px;
		font-size: 12px;
		text-align: center;
	}
</style>
