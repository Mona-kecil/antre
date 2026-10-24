<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { dimensions, nameOf, topicColor, type Dimension, type Meta, type TaxonomyEntry } from '#lib/labels.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { localInput, when, timeZone } from '#lib/displayTime.svelte.ts';
	import { DEFAULT_TOPIC_TAG, MAX_TOPIC_TAG_LENGTH, topicTagSchema } from '#lib/topicTag.ts';
	import Icon from '#lib/components/Icon.svelte';
	import Sheet from '#lib/components/Sheet.svelte';

	type Part = { text: string; imageId?: string; imageUrl?: string; uploading?: boolean };
	let {
		edit,
		nextSlot,
		username,
    connected = true
	}: {
		edit: { id: string; failed: boolean; parts: Part[]; meta: Meta; topicTag: string; topicTagLocked: boolean } | null;
		nextSlot: number | null;
		username: string;
    connected?: boolean;
	} = $props();

	const MAX = 500;
	// The page keys this component by draft id, so the first value is the only one.
	const seed = untrack(() => edit);
	const initial = JSON.stringify(seed ? { parts: seed.parts, meta: seed.meta, topicTag: seed.topicTag } : null);
	let id = $state(seed?.id ?? '');
	let parts = $state<Part[]>(seed ? seed.parts.map((part) => ({ ...part })) : [{ text: '' }]);
	let meta = $state<Meta>({ ...(seed?.meta ?? {}) });
	let topicTag = $state(seed ? seed.topicTag : DEFAULT_TOPIC_TAG);
	let busy = $state(false);
	let saved = $state(false);
	let when_ = $state(false);
	let confirmNow = $state(false);
	let picking = $state<Dimension | null>(null);
	let tagging = $state(false);
	const taxonomy = $derived((page.data.taxonomy ?? []) as TaxonomyEntry[]);
	const length = (text: string) => [...text].length;
	const uploading = $derived(parts.some((part) => part.uploading));
	const topicTagResult = $derived(topicTagSchema.safeParse(topicTag));
	const topicTagError = $derived(topicTagResult.success ? null : topicTagResult.error.issues[0].message);
	const invalid = $derived(
		parts.some((part) => !part.text.trim() || length(part.text) > MAX) || uploading || !topicTagResult.success
	);
	const dirty = $derived(
		seed
			? JSON.stringify({ parts: parts.map(strip), meta, topicTag }) !== initial
			: parts.some((part) => part.text.trim() || part.imageId) || Object.keys(meta).length > 0 || topicTag !== DEFAULT_TOPIC_TAG
	);
	const now = Date.now();

	function strip({ text, imageId, imageUrl }: Part) {
		return { text, imageId, imageUrl };
	}

	beforeNavigate(({ cancel, type }) => {
		if (dirty && !saved && type !== 'leave' && !confirm('Discard your changes to this post?')) cancel();
	});

	function autosize(node: HTMLTextAreaElement) {
		const fit = () => {
			node.style.height = 'auto';
			node.style.height = `${node.scrollHeight}px`;
		};
		fit();
		node.addEventListener('input', fit);
		return { destroy: () => node.removeEventListener('input', fit) };
	}

	async function attach(event: Event, part: Part) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!['image/jpeg', 'image/png'].includes(file.type))
			return toast('Use a JPEG or PNG image.', { error: true });
		if (file.size > 8 * 1024 * 1024) return toast('Images can be up to 8 MB.', { error: true });
		const previous = { imageId: part.imageId, imageUrl: part.imageUrl };
		part.imageUrl = URL.createObjectURL(file);
		part.imageId = undefined;
		part.uploading = true;
		try {
			const ticket = await fetch('/upload');
			if (!ticket.ok) throw new Error();
			const { url } = await ticket.json();
			const response = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': file.type },
				body: file
			});
			if (!response.ok) throw new Error();
			part.imageId = (await response.json()).storageId;
		} catch {
			Object.assign(part, previous);
			toast('The image didn’t upload. Try again.', { error: true });
		} finally {
			part.uploading = false;
		}
	}

	function pick(dimension: Dimension) {
		picking = dimension;
		tagging = true;
	}
</script>

<form
	method="POST"
	action="?/compose"
	class="composer"
	use:enhance={() => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				saved = true;
				when_ = false;
				confirmNow = false;
				toast(String(result.data?.message ?? 'Saved'));
				await goto(String(result.data?.next ?? '/app'), { invalidateAll: true });
			} else if (result.type === 'failure') {
				if (typeof result.data?.draftId === 'string') id = result.data.draftId;
				toast(String(result.data?.error ?? 'That didn’t work. Try again.'), { error: true });
			} else {
				await update({ reset: false });
			}
		};
	}}
>
	<input type="hidden" name="id" value={id} />
	<input type="hidden" name="parts" value={JSON.stringify(parts.map(({ text, imageId }) => ({ text, imageId })))} />
	{#each dimensions as dimension}
		<input type="hidden" name={dimension} value={meta[dimension] ?? ''} />
	{/each}
	<input type="hidden" name="hook" value={meta.hook ?? ''} />

	<header class="bar">
		<a class="cancel" href="/app">Cancel</a>
		<h1>{edit ? (edit.failed ? 'Fix failed post' : 'Edit draft') : 'New thread'}</h1>
		<span class="cancel" aria-hidden="true"></span>
	</header>

  {#if !connected}
    <p class="connection">Save a draft now. <a href="/auth/threads" data-sveltekit-reload>Connect Threads</a> to publish it.</p>
  {/if}

	<div class="parts">
		{#each parts as part, index}
			{@const count = length(part.text)}
			<div class="part" class:last={index === parts.length - 1}>
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
					<label class="sr-only" for="part-{index}">Part {index + 1} text</label>
					<textarea
						id="part-{index}"
						rows="2"
						bind:value={part.text}
						use:autosize
						placeholder={index === 0 ? 'What’s new?' : 'Say more…'}
						aria-describedby="count-{index}"
					></textarea>
					{#if part.imageUrl}
						<div class="image" class:uploading={part.uploading}>
							<img src={part.imageUrl} alt="Attached to part {index + 1}" />
							<button
								type="button"
								class="drop"
								aria-label="Remove image"
								onclick={() => {
									part.imageId = undefined;
									part.imageUrl = undefined;
								}}
							>
								<Icon name="close" size={14} stroke={2.5} />
							</button>
							{#if part.uploading}<span class="badge">Uploading…</span>{/if}
						</div>
					{/if}
					<div class="tools">
						<label class="icon-btn tool" title="Add image">
							<Icon name="image" size={20} />
							<span class="sr-only">{part.imageUrl ? 'Replace image' : 'Add image'}</span>
							<input
								type="file"
								accept="image/jpeg,image/png"
								class="sr-only"
								onchange={(event) => attach(event, part)}
							/>
						</label>
						<span
							id="count-{index}"
							class="count num"
							class:warn={count > MAX - 50}
							class:over={count > MAX}
						>
							{count > MAX - 50 ? MAX - count : `${count}/${MAX}`}
						</span>
					</div>
				</div>
			</div>
		{/each}
		<button type="button" class="add" onclick={() => parts.push({ text: '' })}>
			<span class="rail" aria-hidden="true"><span class="avatar small">{username.slice(0, 1).toUpperCase()}</span></span>
			<span>Add to thread</span>
		</button>
	</div>

	<div class="topic-tag">
		<label class="label" for="topic-tag">Threads topic <span class="muted">· optional</span></label>
		<input
			id="topic-tag"
			class="field"
			name="topicTag"
			bind:value={topicTag}
						placeholder="Add a public topic (optional)"
			readonly={seed?.topicTagLocked}
			aria-invalid={!!topicTagError}
			aria-describedby="topic-tag-hint"
		/>
		<div class="topic-tag-info">
			<p id="topic-tag-hint" class:error={!!topicTagError}>
				{topicTagError ?? (seed?.topicTagLocked ? 'Already published with the first post.' : 'Shown with your first post on Threads. Leave blank for no tag.')}
			</p>
			<span class="num">{length(topicTag.trim())}/{MAX_TOPIC_TAG_LENGTH}</span>
		</div>
	</div>

	<section class="meta" aria-label="Labels and notes">
		<div class="pills">
			{#each dimensions as dimension}
				{@const code = meta[dimension]}
				<button type="button" class="pill" class:on={code} onclick={() => pick(dimension)}>
					{#if code}
						{#if dimension === 'topic'}<i class="dot" style:--c={topicColor(code, taxonomy)}></i>{/if}
						{nameOf(dimension, code, taxonomy)}
					{:else}
						<Icon name="plus" size={14} stroke={2} />{dimension[0].toUpperCase() + dimension.slice(1)}
					{/if}
				</button>
			{/each}
		</div>
		<label class="sr-only" for="notes">Notes</label>
		<textarea
			id="notes"
			name="notes"
			class="notes"
			rows="1"
			bind:value={meta.notes}
			use:autosize
			placeholder="Notes for yourself (not posted)"
		></textarea>
	</section>

	<footer class="foot">
		<button class="btn btn-secondary" name="mode" value="draft" disabled={invalid || busy}>Save draft</button>
		<span class="spacer"></span>
		<button
			type="button"
			class="icon-btn"
			aria-label="Choose when to post"
			disabled={invalid || busy}
			onclick={() => (when_ = true)}
		>
			<Icon name="clock" />
		</button>
		<button class="btn btn-primary" name="mode" value="queue" disabled={invalid || busy}>
			{busy ? 'Saving…' : 'Queue'}
		</button>
	</footer>

	<Sheet bind:open={when_} title={confirmNow ? 'Post now?' : 'When'}>
		{#if confirmNow}
			<p class="muted sheet-copy">This posts to Threads immediately, skipping the queue.</p>
			<div class="stack">
				<button class="btn btn-primary btn-block" name="mode" value="now" disabled={invalid || busy}>Post now</button>
				<button type="button" class="btn btn-secondary btn-block" onclick={() => (confirmNow = false)}>Cancel</button>
			</div>
		{:else}
			<ul class="menu">
				{#if nextSlot}
					<li>
						<button name="mode" value="queue" disabled={invalid || busy}>
							<Icon name="queue" />
							<span><strong>Next free slot</strong><span class="muted">{when(nextSlot, now)}</span></span>
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
			<label class="label" for="at">Pick a time <span class="muted">· {timeZone()}</span></label>
			<input
				id="at"
				class="field"
				type="datetime-local"
				name="at"
				min={localInput(now)}
				value={localInput(nextSlot ?? now + 3_600_000)}
			/>
			<button class="btn btn-primary btn-block schedule" name="mode" value="schedule" disabled={invalid || busy}>
				Schedule
			</button>
		{/if}
	</Sheet>
</form>

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
						<span class="name">
							{entry.name} <span class="code num">{entry.code}</span>
							{#if entry.description}<span class="desc">{entry.description}</span>{/if}
						</span>
						{#if meta[dimension] === entry.code}<Icon name="check" size={18} />{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</Sheet>

<style>
  .connection { padding: 12px 16px; color: var(--fg-2); font-size: 13px; border-bottom: 1px solid var(--line); }
  .connection a { color: var(--fg); text-underline-offset: 3px; }
	.topic-tag {
		padding: 12px 16px 16px;
	}

	.topic-tag-info {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-top: 6px;
		font-size: 12px;
		line-height: 16px;
		color: var(--fg-2);
	}

	.topic-tag-info .num {
		flex-shrink: 0;
	}

	.topic-tag-info .error {
		color: var(--red);
	}

	.composer {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
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

	.bar h1 {
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
		justify-content: space-between;
		min-height: 20px;
	}

	.head strong {
		font-weight: 600;
	}

	.remove {
		width: 28px;
		height: 28px;
		margin: -4px -6px -4px 0;
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

	.image {
		position: relative;
		width: fit-content;
		max-width: 100%;
		margin-top: 8px;
	}

	.image img {
		display: block;
		max-width: 100%;
		max-height: 320px;
		border-radius: 8px;
		outline: 1px solid var(--line);
		outline-offset: -1px;
		transition: opacity 200ms var(--ease);
	}

	.image.uploading img {
		opacity: 0.5;
	}

	.drop {
		position: absolute;
		top: 8px;
		right: 8px;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: rgb(0 0 0 / 0.65);
		color: #fff;
	}

	.badge {
		position: absolute;
		left: 8px;
		bottom: 8px;
		padding: 2px 8px;
		border-radius: 6px;
		background: rgb(0 0 0 / 0.65);
		color: #fff;
		font-size: 12px;
	}

	.tools {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 4px 0 0 -8px;
	}

	.tool {
		color: var(--fg-2);
		cursor: pointer;
	}

	.tool:focus-within {
		outline: 2px solid var(--fg);
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
		padding: 10px 16px calc(10px + var(--safe-b));
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

	.menu button:hover:not(:disabled) {
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

	.desc {
		display: block;
		margin-top: 2px;
		font-size: 13px;
		line-height: 18px;
		color: var(--fg-2);
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
