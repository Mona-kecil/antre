<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate } from '$app/navigation';
	import { untrack } from 'svelte';
	import { MAX_LINKEDIN_TEXT, linkedinTextSchema } from '#lib/linkedin.ts';
	import { localInput, when } from '#lib/displayTime.svelte.ts';
	import Icon from '#lib/components/Icon.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const seed = untrack(() => data.edit);
	let text = $state(seed?.text ?? '');
	let topic = $state(seed?.topic ?? '');
	let notes = $state(seed?.notes ?? '');
	let busy = $state(false);
	let submitted = $state(false);
	let review = $state(false);
	let id = $state(seed?.id ?? '');
	const count = $derived([...text.trim()].length);
	const invalid = $derived(!linkedinTextSchema.safeParse(text).success || busy);
	const dirty = $derived(
		text !== (seed?.text ?? '') ||
			topic !== (seed?.topic ?? '') ||
			notes !== (seed?.notes ?? '')
	);
	const connected = $derived(
		data.connection &&
			!data.connection.needsReconnect &&
			data.connection.tokenExpiresAt > Date.now()
	);
	const min = localInput(Date.now() + 60_000);
	beforeNavigate(({ cancel }) => {
		if (
			dirty &&
			!submitted &&
			!confirm('Discard changes to this LinkedIn draft?')
		)
			cancel();
	});
</script>

<svelte:head
	><title>{seed ? 'Edit' : 'New'} LinkedIn post · antre</title></svelte:head
>
<header class="bar">
	<a class="act" href="/app/linkedin">Cancel</a>
	<h1>{seed ? 'Edit LinkedIn post' : 'New LinkedIn post'}</h1>
	<span aria-hidden="true"></span>
</header>
<form
	method="POST"
	action="?/save"
	use:enhance={() => {
		busy = true;
		submitted = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type !== 'redirect') {
				submitted = false;
				if (
					result.type === 'failure' &&
					typeof result.data?.draftId === 'string'
				)
					id = result.data.draftId;
			}
			await update({ reset: false });
		};
	}}
>
	<input type="hidden" name="id" value={id} />
	<div class="identity">
		<span class="avatar" aria-hidden="true"
			>{(data.connection?.name ?? 'You').slice(0, 1)}</span
		>
		<div>
			<strong>{data.connection?.name ?? 'Your personal profile'}</strong>
			<span class="audience">Anyone</span>
		</div>
	</div>
	{#if !connected}<p class="connection">
			You can save a draft now. <a href="/app/linkedin/settings">Connect LinkedIn</a
			> to publish it.
		</p>{/if}
	<label class="sr-only" for="linkedin-text">LinkedIn post text</label>
	<textarea
		class="post-text"
		id="linkedin-text"
		name="text"
		bind:value={text}
		placeholder="What do you want to talk about?"
		aria-describedby="text-count"
		required></textarea>
	<p class="counter" class:over={count > MAX_LINKEDIN_TEXT} id="text-count">
		{count >= MAX_LINKEDIN_TEXT * 0.7 ? `${count.toLocaleString()} / ${MAX_LINKEDIN_TEXT.toLocaleString()}` : ''}
	</p>
	<div class="fields">
		<label for="topic">Topic</label
		><input
			class="field"
			id="topic"
			name="topic"
			bind:value={topic}
			list="linkedin-topics"
			maxlength="100"
			placeholder="Choose or add a topic"
		/><datalist id="linkedin-topics"
			>{#each data.settings.topics as value}<option {value}
				></option>{/each}</datalist
		><label for="notes">Notes</label><textarea
			class="field notes"
			id="notes"
			name="notes"
			bind:value={notes}
			maxlength="5000"
			></textarea>
	</div>
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	<div class="actions">
		<button class="btn btn-secondary" name="mode" value="draft" disabled={invalid}>Save draft</button>
		<span class="spacer"></span>
		{#if data.preset}
			<button class="btn btn-primary" name="mode" value="schedule" disabled={invalid}>
				Schedule · {when(data.preset)}
			</button>
		{:else}
			<button class="btn btn-primary" name="mode" value="queue" disabled={invalid}>Queue</button>
		{/if}
	</div>
	<details class="timing">
		<summary>Choose a time</summary><label for="publish-time"
			>Time in {data.settings.timeZone}</label
		><input
			class="field"
			id="publish-time"
			type="datetime-local"
			name="at"
			{min}
			value={data.preset ? localInput(data.preset) : undefined}
		/><button
			class="btn btn-secondary"
			name="mode"
			value="schedule"
			disabled={invalid}>Schedule on LinkedIn</button
		>
	</details>
	{#if connected}<div class="now">
			<button
				type="button"
				class="act"
				disabled={invalid}
				onclick={() => (review = !review)}
				><Icon name="send" size={18} />Review for publishing now</button
			>{#if review}<p>
					This post will be public on <strong
						>{data.connection?.name}'s LinkedIn profile</strong
					>.
				</p>
				<button
					class="btn btn-primary"
					name="mode"
					value="now"
					disabled={invalid}>Publish on LinkedIn now</button
				>{/if}
		</div>{/if}
</form>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: grid;
		grid-template-columns: 64px 1fr 64px;
		align-items: center;
		min-height: var(--bar);
		padding: 0 16px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}
	h1 {
		font-size: 17px;
		text-align: center;
	}
	.identity {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 20px 16px 12px;
	}
	.identity div {
		display: grid;
		justify-items: start;
		gap: 2px;
	}
	.identity strong {
		font-size: 16px;
	}
	.audience {
		padding: 1px 10px;
		border: 1px solid var(--line-2);
		border-radius: 999px;
		color: var(--fg-2);
		font-size: 12.5px;
	}
	.avatar {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		font-size: 18px;
		border-radius: 50%;
		background: var(--primary);
		color: var(--on-primary);
		font-weight: 700;
	}
	.connection {
		margin: 0 16px 12px;
		font-size: 13px;
		color: var(--fg-2);
	}
	.connection a {
		color: var(--fg);
		text-underline-offset: 3px;
	}
	.post-text {
		display: block;
		width: 100%;
		min-height: 260px;
		padding: 12px 16px;
		border: 0;
		background: transparent;
		resize: vertical;
		color: var(--fg);
		font: inherit;
		font-size: 17px;
		line-height: 1.5;
	}
	.post-text::placeholder {
		color: var(--fg-2);
	}
	.counter {
		padding: 4px 16px 16px;
		text-align: right;
		font-size: 12px;
		color: var(--fg-2);
		font-variant-numeric: tabular-nums;
	}
	.over,
	.error {
		color: var(--red);
	}
	.fields {
		display: grid;
		gap: 8px;
		padding: 16px;
		border-top: 1px solid var(--line);
		font-size: 13px;
	}
	.fields label:not(:first-child) {
		margin-top: 8px;
	}
	.notes {
		min-height: 72px;
		padding: 10px 12px;
		resize: vertical;
	}
	.actions {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		border-top: 1px solid var(--line);
		background: var(--bg);
	}
	.spacer {
		flex: 1;
	}
	.error {
		padding: 8px 16px;
		font-size: 13px;
	}
	.timing,
	.now {
		padding: 12px 16px 24px;
		border-top: 1px solid var(--line);
		font-size: 13px;
	}
	.timing summary {
		cursor: pointer;
		padding-bottom: 12px;
	}
	.timing input {
		margin: 8px 0 12px;
	}
	.now p {
		margin: 8px 0 12px;
	}
</style>
