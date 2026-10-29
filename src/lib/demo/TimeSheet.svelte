<script lang="ts">
	import { clock, localInput, timeZone, when } from '#lib/displayTime.svelte.ts';
	import { parseLocal } from '#lib/time.ts';
	import Icon from '../components/Icon.svelte';
	import Sheet from '../components/Sheet.svelte';

	let {
		open = $bindable(false),
		title,
		now,
		nextSlot,
		free = [],
		at = null,
		onpick
	}: {
		open?: boolean;
		title: 'Schedule' | 'Move';
		now: number;
		nextSlot: number | null;
		free?: number[];
		at?: number | null;
		onpick: (at: number | 'next') => boolean;
	} = $props();
	let picked = $state('');
	const pick = (value: number | 'next') => {
		if (onpick(value)) open = false;
	};
	$effect(() => {
		if (open) picked = localInput(at && at > now ? at : (nextSlot ?? now + 3_600_000));
	});
</script>

<Sheet bind:open {title}>
	{#if at}<p class="muted now-at">Now {when(at, now)}</p>{/if}
	{#if nextSlot}
		<button type="button" class="row" onclick={() => pick('next')}>
			<Icon name="queue" />
			<span>
				<strong>Next free slot</strong>
				<span class="muted">{when(nextSlot, now)}</span>
			</span>
		</button>
	{/if}
	{#if free.length}
		<p class="label">Free on this day</p>
		<div class="chips">
			{#each free as slot}
				<button type="button" class="chip num" onclick={() => pick(slot)}>{clock(slot)}</button>
			{/each}
		</div>
	{/if}
	<form
		class="pick"
		onsubmit={(event) => {
			event.preventDefault();
			const at = parseLocal(picked, timeZone());
			if (at !== null) pick(at);
		}}
	>
		<label class="label" for="sample-when">Pick a time <span class="muted">· {timeZone()}</span></label>
		<input id="sample-when" class="field" type="datetime-local" required min={localInput(now)} bind:value={picked} />
		<button class="btn btn-primary btn-block">{title === 'Schedule' ? 'Schedule' : 'Move here'}</button>
	</form>
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
</style>
