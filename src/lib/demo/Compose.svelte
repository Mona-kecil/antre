<script lang="ts">
	import { untrack } from 'svelte';
	import { isoDay, localInput, timeZone, when } from '#lib/displayTime.svelte.ts';
	import { dimensions, nameOf, topicColor, type Dimension } from '#lib/labels.ts';
	import { parseLocal } from '#lib/time.ts';
	import Icon from '../components/Icon.svelte';
	import Sheet from '../components/Sheet.svelte';
	import { names, taxonomy } from './fixtures';
	import { href, type Sandbox } from './sandbox.svelte';
	import type { DemoPost, DemoStore } from './store';

	let { sandbox }: { sandbox: Sandbox } = $props();
	// The workspace keys this view by URL, so the first route is the only one.
	const route = untrack(() => sandbox.route) as Extract<Sandbox['route'], { name: 'compose' }>;
	const channel = route.channel;
	const seed = untrack(() => sandbox.posts.find((post) => post.id === route.edit && post.status.kind !== 'published'));
	const preset = route.at && route.at > untrack(() => sandbox.now) ? route.at : null;
	const linkedin = channel === 'linkedin';
	const MAX = linkedin ? 3000 : 500;
	const username = names[channel];
	let id = $state(seed?.id);
	let parts = $state(seed ? seed.parts.map((part) => ({ ...part })) : [{ text: '' }]);
	let meta = $state<DemoPost['meta']>({ ...seed?.meta });
	let choosing = $state(false);
	let confirmNow = $state(false);
	let picked = $state('');
	let picking = $state<Dimension | null>(null);
	let tagging = $state(false);
	const length = (text: string) => [...text].length;
	const invalid = $derived(parts.some((part) => !part.text.trim() || length(part.text) > MAX));
	const title = seed?.status.kind === 'failed' ? 'Fix failed post' : seed ? (linkedin ? 'Edit post' : 'Edit draft') : linkedin ? 'New post' : 'New thread';

	function autosize(node: HTMLTextAreaElement) {
		const fit = () => {
			node.style.height = 'auto';
			node.style.height = `${node.scrollHeight}px`;
		};
		fit();
		node.addEventListener('input', fit);
		return { destroy: () => node.removeEventListener('input', fit) };
	}

	/** Saves the post, then places it; the draft keeps its id if placing fails. */
	function submit(place?: (store: DemoStore, id: string) => number) {
		let target = href(channel, 'drafts');
		const done = sandbox.act((store) => {
			id = store.save({ id, channel, parts, meta });
			if (!place) return 'Saved to drafts';
			const at = place(store, id);
			const published = store.state.posts.some((post) => post.id === id && post.status.kind === 'published');
			target = `${href(channel, published ? 'library' : 'schedule', published ? {} : { day: isoDay(at) })}#post-${id}`;
			if (!published) sandbox.arrived(id);
			return published ? `Posted to ${linkedin ? 'LinkedIn' : 'Threads'}` : `Scheduled for ${when(at, sandbox.now)}`;
		});
		if (!done) return;
		choosing = false;
		sandbox.go(target);
	}

	const queue = () => submit((store, id) => store.queue(id));
	const scheduleAt = (at: number) => submit((store, id) => (store.schedule(id, at), at));
	const publish = () => submit((store, id) => (store.publish(id), sandbox.now));

	$effect(() => {
		if (choosing) picked = localInput(preset ?? sandbox.nextSlot ?? sandbox.now + 3_600_000);
	});
</script>

<form
	class="composer"
	onsubmit={(event) => {
		event.preventDefault();
		if (preset) scheduleAt(preset);
		else queue();
	}}
>
	<header class="bar">
		<a class="cancel" href={href(channel, 'drafts')}>Cancel</a>
		<h2>{title}</h2>
		<span class="cancel" aria-hidden="true"></span>
	</header>

	<div class="parts">
		{#each parts as part, index}
			{@const count = length(part.text)}
			<div class="part">
				<div class="rail" aria-hidden="true">
					{#if index === 0}
						<span class="avatar">{username.slice(0, 1).toUpperCase()}</span>
					{:else}
						<span class="node"></span>
					{/if}
				</div>
				<div class="body">
					<div class="head">
						<strong>{index === 0 ? username : `Part ${index + 1}`}</strong>
						{#if parts.length > 1}
							<button
								type="button"
								class="icon-btn remove"
								aria-label="Remove part {index + 1}"
								onclick={() => parts.splice(index, 1)}
							>
								<Icon name="close" size={16} />
							</button>
						{/if}
					</div>
					<label class="sr-only" for="sample-part-{index}">Part {index + 1} text</label>
					<textarea
						id="sample-part-{index}"
						rows="2"
						bind:value={part.text}
						use:autosize
						placeholder={index === 0 ? (linkedin ? 'What do you want to talk about?' : 'What’s new?') : 'Say more…'}
					></textarea>
					<div class="tools">
						<span class="count num" class:warn={count > MAX - 50} class:over={count > MAX}>
							{count > MAX - 50 ? MAX - count : count >= MAX * 0.7 ? `${count}/${MAX}` : ''}
						</span>
					</div>
				</div>
			</div>
		{/each}
		{#if !linkedin}
			<button type="button" class="add" onclick={() => parts.push({ text: '' })}>
				<span class="rail" aria-hidden="true"><span class="avatar small">{username.slice(0, 1).toUpperCase()}</span></span>
				<span>Add to thread</span>
			</button>
		{/if}
	</div>

	<section class="meta" aria-label="Labels and notes">
		<div class="pills">
			{#each dimensions as dimension}
				{@const code = meta[dimension]}
				<button
					type="button"
					class="pill"
					class:on={code}
					onclick={() => {
						picking = dimension;
						tagging = true;
					}}
				>
					{#if code}
						{#if dimension === 'topic'}<i class="dot" style:--c={topicColor(code, taxonomy)}></i>{/if}
						{nameOf(dimension, code, taxonomy)}
					{:else}
						<Icon name="plus" size={14} stroke={2} />{dimension[0].toUpperCase() + dimension.slice(1)}
					{/if}
				</button>
			{/each}
		</div>
		<label class="sr-only" for="sample-notes">Notes</label>
		<textarea
			id="sample-notes"
			class="notes"
			rows="1"
			bind:value={meta.notes}
			use:autosize
			placeholder="Notes"
		></textarea>
	</section>

	<footer class="foot">
		<button type="button" class="btn btn-secondary" disabled={invalid} onclick={() => submit()}>Save draft</button>
		<span class="spacer"></span>
		<button
			type="button"
			class="icon-btn"
			aria-label="Choose when to post"
			disabled={invalid}
			onclick={() => {
				confirmNow = false;
				choosing = true;
			}}
		>
			<Icon name="clock" />
		</button>
		<button class="btn btn-primary" disabled={invalid}>
			{preset ? `Schedule · ${when(preset, sandbox.now)}` : 'Queue'}
		</button>
	</footer>
</form>

<Sheet bind:open={choosing} title={confirmNow ? 'Post now?' : 'When'}>
	{#if confirmNow}
		<p class="muted sheet-copy">This posts to {linkedin ? 'LinkedIn' : 'Threads'} immediately, skipping the queue.</p>
		<div class="stack">
			<button type="button" class="btn btn-primary btn-block" onclick={publish}>Post now</button>
			<button type="button" class="btn btn-secondary btn-block" onclick={() => (confirmNow = false)}>Cancel</button>
		</div>
	{:else}
		<ul class="menu">
			{#if sandbox.nextSlot}
				<li>
					<button type="button" onclick={queue}>
						<Icon name="queue" />
						<span><strong>Next free slot</strong><span class="muted">{when(sandbox.nextSlot, sandbox.now)}</span></span>
					</button>
				</li>
			{/if}
			<li>
				<button type="button" onclick={() => (confirmNow = true)}>
					<Icon name="send" />
					<span><strong>Post now</strong><span class="muted">Skip the queue</span></span>
				</button>
			</li>
		</ul>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				const at = parseLocal(picked, timeZone());
				if (at === null) sandbox.say('Choose a date and time', true);
				else scheduleAt(at);
			}}
		>
			<label class="label" for="sample-at">Pick a time <span class="muted">· {timeZone()}</span></label>
			<input id="sample-at" class="field" type="datetime-local" required min={localInput(sandbox.now)} bind:value={picked} />
			<button class="btn btn-primary btn-block schedule">Schedule</button>
		</form>
	{/if}
</Sheet>

<Sheet bind:open={tagging} title={picking ? picking[0].toUpperCase() + picking.slice(1) : 'Label'}>
	{#if picking}
		{@const dimension = picking}
		<ul class="menu">
			<li>
				<button type="button" onclick={() => ((meta[dimension] = undefined), (tagging = false))}>
					<span class="name">No {dimension}</span>
					{#if !meta[dimension]}<Icon name="check" size={18} />{/if}
				</button>
			</li>
			{#each taxonomy.filter((entry) => entry.dimension === dimension) as entry (entry.code)}
				<li>
					<button type="button" onclick={() => ((meta[dimension] = entry.code), (tagging = false))}>
						{#if dimension === 'topic'}<i class="dot" style:--c={topicColor(entry.code, taxonomy)}></i>{/if}
						<span class="name">{entry.name} <span class="code num">{entry.code}</span></span>
						{#if meta[dimension] === entry.code}<Icon name="check" size={18} />{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</Sheet>

<style>
	.composer {
		display: flex;
		flex-direction: column;
		min-height: 100%;
	}

	.bar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: grid;
		grid-template-columns: 72px 1fr 72px;
		align-items: center;
		height: var(--bar);
		padding: 0 16px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}

	.bar h2 {
		font-size: 16px;
		font-weight: 700;
		text-align: center;
	}

	.cancel {
		font-size: 15px;
		text-decoration: none;
	}

	.parts {
		padding: 16px 16px 4px;
	}

	.part {
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr);
		column-gap: 12px;
		padding-bottom: 12px;
	}

	.rail {
		position: relative;
		display: flex;
		justify-content: center;
	}

	.part .rail::after {
		content: '';
		position: absolute;
		top: var(--rail-top, 42px);
		bottom: -8px;
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
		background: var(--primary);
		color: var(--on-primary);
		font-size: 15px;
		font-weight: 700;
	}

	.avatar.small {
		width: 18px;
		height: 18px;
		font-size: 9px;
		opacity: 0.45;
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
	}

	.head strong {
		font-weight: 600;
	}

	.remove {
		width: 28px;
		height: 28px;
		margin: -4px -6px -4px auto;
		color: var(--fg-2);
	}

	textarea {
		display: block;
		width: 100%;
		min-height: 42px;
		margin-top: 2px;
		padding: 0;
		border: 0;
		background: none;
		resize: none;
		line-height: 21px;
		outline: none;
		overflow: hidden;
	}

	.tools {
		display: flex;
		justify-content: flex-end;
		min-height: 16px;
	}

	.count {
		font-size: 12px;
		color: var(--fg-3);
	}

	.count.warn {
		color: var(--amber);
	}

	.count.over {
		color: var(--red);
		font-weight: 600;
	}

	.add {
		display: grid;
		grid-template-columns: 36px 1fr;
		column-gap: 12px;
		align-items: center;
		width: 100%;
		padding: 2px 0 8px;
		color: var(--fg-3);
		text-align: left;
	}

	.meta {
		margin: 4px 16px 0 64px;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}

	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		padding: 0 10px;
		border-radius: 8px;
		border: 1px dashed var(--line-2);
		color: var(--fg-2);
		font-size: 13px;
		font-weight: 500;
		transition: transform 160ms var(--ease);
	}

	.pill.on {
		gap: 6px;
		border-style: solid;
		color: var(--fg);
	}

	.pill:active {
		transform: scale(0.96);
	}

	.dot {
		width: 8px;
		height: 8px;
		flex: none;
		border-radius: 50%;
		background: var(--c);
	}

	.notes {
		min-height: 21px;
		margin-top: 12px;
		font-size: 13px;
		line-height: 18px;
		color: var(--fg-2);
	}

	.foot {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: auto;
		padding: 10px 16px;
		background: var(--bg);
		border-top: 1px solid var(--line);
	}

	.spacer {
		flex: 1;
	}

	.sheet-copy {
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
		gap: 12px;
		width: 100%;
		min-height: 52px;
		padding: 8px 16px;
		text-align: left;
	}

	.menu button:hover {
		background: var(--press);
	}

	.menu button > span {
		display: flex;
		flex-direction: column;
	}

	.menu strong {
		font-weight: 600;
	}

	.menu .muted {
		font-size: 13px;
	}

	.name {
		flex: 1;
	}

	.code {
		margin-left: 4px;
		font-size: 12px;
		color: var(--fg-3);
	}

	.label {
		display: block;
		margin: 16px 0 8px;
		font-size: 13px;
		font-weight: 600;
	}

	.schedule {
		margin-top: 12px;
	}
</style>
