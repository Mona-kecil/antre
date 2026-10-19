<script lang="ts">
	import { page } from '$app/state';
	import { nameOf, topicColor, type Meta, type TaxonomyEntry } from '#lib/labels.ts';
	import type { Snippet } from 'svelte';

	let { meta, children }: { meta: Meta; children?: Snippet } = $props();
	const taxonomy = $derived((page.data.taxonomy ?? []) as TaxonomyEntry[]);
	const rest = $derived(
		(['angle', 'format'] as const).flatMap((d) => (meta[d] ? [nameOf(d, meta[d], taxonomy)] : []))
	);
</script>

<p class="labels">
	{#if meta.topic}
		<span class="label" title={meta.topic}>
			<i class="dot" style:--c={topicColor(meta.topic, taxonomy)}></i>{nameOf('topic', meta.topic, taxonomy)}
		</span>
	{:else}
		<span class="label"><i class="dot empty"></i>No topic</span>
	{/if}
	{#each rest as name}<span class="sep" aria-hidden="true">·</span><span class="label">{name}</span>{/each}
	{@render children?.()}
</p>

<style>
	.labels {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 4px;
		row-gap: 2px;
		font-size: 12px;
		line-height: 16px;
		color: var(--fg-2);
	}

	.label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
	}

	.dot.empty {
		background: none;
		box-shadow: inset 0 0 0 1.5px var(--fg-3);
	}

	.sep {
		color: var(--fg-3);
	}
</style>
