<script lang="ts">
	import type { Snippet } from 'svelte';

	type Part = { text: string; imageUrl?: string | null };
	let {
		parts,
		username,
		head,
		sub,
		children,
		selected = false,
		id
	}: {
		parts: Part[];
		username: string;
		head?: Snippet;
		sub?: Snippet;
		children?: Snippet;
		selected?: boolean;
		id?: string;
	} = $props();
</script>

<article class="post" class:selected {id}>
	{#each parts as part, index}
		<div class="part" class:last={index === parts.length - 1}>
			<div class="rail" aria-hidden="true">
				{#if index === 0}
					<span class="avatar">{username.slice(0, 1).toUpperCase()}</span>
				{:else}
					<span class="node"></span>
				{/if}
			</div>
			<div class="body">
				{#if index === 0}
					<div class="head">
						<strong>{username}</strong>
						{@render head?.()}
					</div>
					{#if sub}<div class="sub">{@render sub()}</div>{/if}
				{/if}
				{#if parts.length > 1}
					<p class="index num">{index + 1}/{parts.length}</p>
				{/if}
				<p class="text">{part.text}</p>
				{#if part.imageUrl}
					<img
						src={part.imageUrl}
						alt={`Image in part ${index + 1}`}
						loading="lazy"
						decoding="async"
					/>
				{/if}
			</div>
		</div>
	{/each}
	{#if children}<div class="foot">{@render children()}</div>{/if}
</article>

<style>
	.post {
		padding: 12px 16px 8px;
		border-bottom: 1px solid var(--line);
		transition: background-color 600ms var(--ease);
		scroll-margin-top: calc(var(--bar) + 12px);
	}

	.post.selected {
		background: var(--press);
	}

	.part {
		position: relative;
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr);
		column-gap: 12px;
		padding-bottom: 14px;
	}

	.part.last {
		padding-bottom: 0;
	}

	/* The thread connector: avatar or node, then a line down to the next part. */
	.rail {
		position: relative;
		display: flex;
		justify-content: center;
	}

	.part:not(.last) .rail::after {
		content: '';
		position: absolute;
		top: var(--rail-top, 42px);
		bottom: -12px;
		left: 50%;
		width: 2px;
		margin-left: -1px;
		border-radius: 1px;
		background: var(--line-2);
	}

	.part + .part .rail {
		--rail-top: 18px;
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--fg);
		color: var(--on-fg);
		font-size: 15px;
		font-weight: 700;
	}

	.node {
		width: 10px;
		height: 10px;
		margin-top: 4px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 2px var(--line-2);
	}

	.head {
		display: flex;
		align-items: center;
		min-height: 20px;
		flex-wrap: wrap;
		column-gap: 6px;
	}

	.head strong {
		font-weight: 600;
	}

	.sub {
		margin-top: 2px;
	}

	.index {
		margin-top: 2px;
		font-size: 12px;
		line-height: 16px;
		color: var(--fg-2);
	}

	.part:first-child .index {
		display: none;
	}

	.text {
		margin-top: 2px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 21px;
	}

	img {
		display: block;
		max-width: 100%;
		max-height: 420px;
		height: auto;
		margin-top: 10px;
		border-radius: 8px;
		outline: 1px solid var(--line);
		outline-offset: -1px;
	}

	.foot {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		margin: 6px 0 0 48px;
	}
</style>
