<script lang="ts">
	import { daySlots, clock } from './time';
	import type { SchedulingSettings } from '../domain/scheduling';
	let {
		day,
		settings,
		posts,
		next = null,
		selected = null,
		onselect
	}: {
		day: string;
		settings: SchedulingSettings;
		posts: { id: string; at: number; kind: string }[];
		next?: number | null;
		selected?: string | null;
		onselect?: (id: string) => void;
	} = $props();
	const slots = $derived(daySlots(day, settings));
	const times = $derived([...slots, ...posts.map((post) => post.at)]);
	const first = $derived(Math.min(...times));
	const last = $derived(Math.max(...times));
	const position = (at: number) =>
		times.length > 1 && last !== first
			? 7 + ((at - first) / (last - first)) * 86
			: 50;
</script>

<div class="timeline" aria-label="DayLine sample schedule">
	{#if times.length}
		<div class="track"></div>
		{#each slots as at}
			<span class="slot" style:left="{position(at)}%" aria-hidden="true"></span>
		{/each}
		{#if next !== null && slots.includes(next)}
			<span class="next" style:left="{position(next)}%"
				><span></span><small>Next</small></span
			>
		{/if}
		{#each posts as post}
			{#if onselect}
				<button
					type="button"
					class="mark {post.kind}"
					class:selected={post.id === selected}
					style:left="{position(post.at)}%"
					aria-label="Select {post.kind} post at {clock(
						post.at,
						settings.timeZone
					)}"
					aria-pressed={post.id === selected}
					onclick={() => onselect?.(post.id)}><span></span></button
				>
			{:else}
				<span
					class="static-mark {post.kind}"
					style:left="{position(post.at)}%"
					aria-hidden="true"
				></span>
			{/if}
		{/each}
		<span class="edge start">{clock(first, settings.timeZone)}</span>
		<span class="edge end">{clock(last, settings.timeZone)}</span>
	{:else}
		<p>No posting slots on this day.</p>
	{/if}
</div>

<style>
	.timeline {
		position: relative;
		height: 92px;
		border-bottom: 1px solid var(--line);
		overflow: hidden;
	}
	.track {
		position: absolute;
		top: 35px;
		left: 7%;
		right: 7%;
		height: 8px;
		border-radius: 4px;
		background: var(--bg-2);
	}
	.slot {
		position: absolute;
		top: 37px;
		width: 4px;
		height: 4px;
		border: 1px solid var(--fg-3);
		border-radius: 50%;
		transform: translateX(-50%);
	}
	.mark {
		position: absolute;
		top: 17px;
		width: 36px;
		height: 44px;
		transform: translateX(-50%);
		border-radius: 8px;
	}
	.mark span,
	.static-mark {
		display: block;
		width: 8px;
		height: 16px;
		border-radius: 4px;
		background: var(--fg);
	}
	.mark span {
		margin: auto;
		transition: height 260ms var(--ease);
	}
	.mark:hover {
		background: var(--press);
	}
	.mark.selected span {
		height: 26px;
	}
	.static-mark {
		position: absolute;
		top: 31px;
		transform: translateX(-50%);
	}
	.mark.failed span,
	.static-mark.failed {
		background: var(--red);
	}
	.mark.held span,
	.static-mark.held {
		background: var(--bg);
		border: 2px solid var(--amber);
	}
	.mark.published span,
	.static-mark.published {
		opacity: 0.35;
	}
	.next {
		position: absolute;
		top: 33px;
		transform: translateX(-50%);
		text-align: center;
	}
	.next > span {
		display: block;
		width: 12px;
		height: 12px;
		margin: 0 auto;
		border: 1.5px solid var(--fg);
		border-radius: 50%;
	}
	.next small {
		display: block;
		margin-top: 4px;
		font-size: 11px;
		font-weight: 600;
	}
	.edge {
		position: absolute;
		bottom: 8px;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--fg-2);
	}
	.start {
		left: 7%;
		transform: translateX(-50%);
	}
	.end {
		right: 7%;
		transform: translateX(50%);
	}
	p {
		padding: 32px 16px;
		font-size: 13px;
		color: var(--fg-2);
	}
</style>
