<script lang="ts">
	import { page } from '$app/state';
	import { dimensions, nameOf, topicColor, type Dimension, type TaxonomyEntry } from '#lib/labels.ts';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';

	let {
		facets,
		placeholder = 'Search text, hooks, notes'
	}: { facets: Record<Dimension, Record<string, number>>; placeholder?: string } = $props();
	const taxonomy = $derived((page.data.taxonomy ?? []) as TaxonomyEntry[]);
	const params = $derived(page.url.searchParams);
	let picking = $state<Dimension | null>(null);
	let open = $state(false);
	const title = (d: Dimension) => d[0].toUpperCase() + d.slice(1);

	function href(changes: Record<string, string | null>) {
		const url = new URL(page.url.href);
		url.searchParams.delete('page');
		for (const [key, value] of Object.entries(changes))
			if (value === null) url.searchParams.delete(key);
			else url.searchParams.set(key, value);
		return url.pathname + url.search;
	}

	function options(dimension: Dimension) {
		const counts = facets[dimension] ?? {};
		const codes = new Set([
			...taxonomy.filter((entry) => entry.dimension === dimension).map((entry) => entry.code),
			...Object.keys(counts)
		]);
		return [...codes]
			.sort()
			.map((code) => ({ code, count: counts[code] ?? 0 }))
			.filter(({ code, count }) => count > 0 || params.get(dimension) === code);
	}
</script>

<div class="filters">
	<form method="GET" role="search">
		{#each [...params] as [key, value]}
			{#if key !== 'q' && key !== 'page'}<input type="hidden" name={key} {value} />{/if}
		{/each}
		<label class="search">
			<Icon name="search" size={18} />
			<span class="sr-only">Search</span>
			<input type="search" name="q" value={params.get('q') ?? ''} {placeholder} enterkeyhint="search" />
		</label>
	</form>
	<div class="pills">
		{#each dimensions as dimension}
			{@const code = params.get(dimension)}
			{#if code}
				<span class="pill on">
					<button
						type="button"
						onclick={() => {
							picking = dimension;
							open = true;
						}}
					>
						{#if dimension === 'topic'}<i class="dot" style:--c={topicColor(code, taxonomy)}></i>{/if}
						{nameOf(dimension, code, taxonomy)}
					</button>
					<a href={href({ [dimension]: null })} aria-label={`Clear ${dimension} filter`}>
						<Icon name="close" size={14} stroke={2} />
					</a>
				</span>
			{:else}
				<button
					type="button"
					class="pill"
					onclick={() => {
						picking = dimension;
						open = true;
					}}
				>
					{title(dimension)}<Icon name="down" size={14} stroke={2} />
				</button>
			{/if}
		{/each}
	</div>
</div>

<Sheet bind:open title={picking ? `Filter by ${picking}` : 'Filter'}>
	{#if picking}
		{@const dimension = picking}
		<ul class="options">
			<li>
				<a href={href({ [dimension]: null })} onclick={() => (open = false)} class:on={!params.get(dimension)}>
					<span class="name">Any {dimension}</span>
					{#if !params.get(dimension)}<Icon name="check" size={18} />{/if}
				</a>
			</li>
			{#each options(dimension) as { code, count }}
				<li>
					<a
						href={href({ [dimension]: code })}
						onclick={() => (open = false)}
						class:on={params.get(dimension) === code}
					>
						{#if dimension === 'topic'}<i class="dot" style:--c={topicColor(code, taxonomy)}></i>{/if}
						<span class="code num">{code}</span>
						<span class="name">{nameOf(dimension, code, taxonomy)}</span>
						<span class="count num">{count}</span>
						{#if params.get(dimension) === code}<Icon name="check" size={18} />{/if}
					</a>
				</li>
			{:else}
				<li class="empty muted">No {dimension} tags in this view.</li>
			{/each}
		</ul>
	{/if}
</Sheet>

<style>
	.filters {
		padding: 10px 16px 10px;
		border-bottom: 1px solid var(--line);
	}

	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		padding: 0 12px;
		border-radius: 10px;
		background: var(--bg-2);
		color: var(--fg-2);
	}

	.search:focus-within {
		box-shadow: inset 0 0 0 1px var(--line-2);
	}

	input {
		flex: 1;
		min-width: 0;
		height: 100%;
		border: 0;
		background: none;
		color: var(--fg);
		outline: none;
	}

	input::placeholder {
		color: var(--fg-2);
	}

	.pills {
		display: flex;
		gap: 6px;
		margin-top: 10px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex: none;
		height: 28px;
		padding: 0 10px;
		border-radius: 8px;
		border: 1px solid var(--line-2);
		color: var(--fg-2);
		font-size: 13px;
		font-weight: 500;
		transition: transform 160ms var(--ease);
	}

	.pill:active {
		transform: scale(0.96);
	}

	.pill.on {
		gap: 0;
		padding: 0;
		border-color: var(--fg);
		color: var(--fg);
	}

	.pill.on button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 100%;
		padding: 0 4px 0 10px;
		font-weight: 500;
	}

	.pill.on a {
		display: grid;
		place-items: center;
		width: 26px;
		height: 100%;
		color: var(--fg-2);
	}

	.dot {
		width: 8px;
		height: 8px;
		flex: none;
		border-radius: 50%;
		background: var(--c);
	}

	.options {
		margin: 0 -16px;
		padding: 0;
		list-style: none;
	}

	.options a {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		padding: 0 16px;
		text-decoration: none;
	}

	.options a:hover {
		background: var(--press);
	}

	.options a.on {
		font-weight: 600;
	}

	.code {
		width: 32px;
		font-size: 12px;
		color: var(--fg-2);
		font-weight: 400;
	}

	.name {
		flex: 1;
	}

	.count {
		font-size: 13px;
		color: var(--fg-2);
		font-weight: 400;
	}

	.empty {
		padding: 12px 16px;
	}
</style>
