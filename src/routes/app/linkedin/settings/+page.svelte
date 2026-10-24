<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { act } from '#lib/toast.svelte.ts';
	import { dayLabel } from '#lib/displayTime.svelte.ts';
	import TimeZoneField from '#lib/components/TimeZoneField.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const seed = untrack(() => data.settings);
	let windows = $state(seed.windows.map((window) => ({ ...window })));
	const account = $derived(data.connection);
	const expires = $derived(
		account
			? Math.max(
					0,
					Math.floor((account.tokenExpiresAt - Date.now()) / 86_400_000)
				)
			: 0
	);
</script>

<svelte:head><title>LinkedIn settings · antre</title></svelte:head>
<TopBar title="Settings"
	>{#snippet lead()}<a
			class="icon-btn"
			href="/app/linkedin"
			aria-label="Back to LinkedIn drafts"><Icon name="left" /></a
		>{/snippet}</TopBar
>
<section>
	<h2>Personal LinkedIn profile</h2>
	{#if data.result === 'connected'}<p class="success" role="status">
			LinkedIn connected.
		</p>{:else if data.result === 'cancelled'}<p class="muted" role="status">
			Connection cancelled. Your drafts are saved.
		</p>{/if}
	{#if account}<p class="name">{account.name}</p>
		<p class:problem={account.needsReconnect || expires <= 7} class="lede">
			{account.needsReconnect
				? 'Reconnect to release waiting posts.'
				: `Access ends ${dayLabel(account.tokenExpiresAt)} · ${expires} days left`}
		</p>{:else}<p class="lede muted">
			Connect the personal profile you want to publish from.
		</p>{/if}
	{#if data.configured}<a
			class="btn btn-primary"
			href="/auth/linkedin"
			data-sveltekit-reload
			>{account ? 'Reconnect LinkedIn' : 'Connect LinkedIn'}</a
		>{:else}<p class="problem">
			LinkedIn connection setup is not complete on this deployment.
		</p>{/if}
	<p class="hint">
		Your Antre account stays signed in. This profile supplies LinkedIn publishing access.
	</p>
  {#if account && !account.needsReconnect}
    <details>
      <summary>Disconnect LinkedIn</summary>
      <form method="POST" action="?/disconnect" use:enhance={act()}>
        <input type="hidden" name="channel" value="linkedin" />
        <p class="lede muted">Queued posts wait for this profile to reconnect. Posts already sent stay online. A request in flight may still publish.</p>
        <label class="confirm"><input type="checkbox" name="confirm" required />Disconnect this posting profile</label>
        <button class="btn btn-secondary">Disconnect LinkedIn</button>
      </form>
    </details>
  {/if}
  <p class="hint"><a href="/app/settings">Workspace, agent keys, and account settings</a></p>
</section>
<form method="POST" action="?/save" use:enhance={act()}>
	<section>
		<h2>Posting windows</h2>
		<p class="lede muted">These slots belong to LinkedIn. Existing queued times stay fixed when the zone changes.</p>
		<TimeZoneField value={seed.timeZone} id="linkedin-time-zone" label="LinkedIn time zone" />
		<div class="windows">
			{#each windows as window, index}<div class="window">
					<input
						class="field"
						type="time"
						name="start"
						bind:value={window.start}
						aria-label={`Window ${index + 1} start`}
						required
					/><span>to</span><input
						class="field"
						type="time"
						name="end"
						bind:value={window.end}
						aria-label={`Window ${index + 1} end`}
						required
					/><button
						type="button"
						class="icon-btn"
						disabled={windows.length === 1}
						aria-label={`Remove window ${index + 1}`}
						onclick={() => windows.splice(index, 1)}
						><Icon name="close" size={18} /></button
					>
				</div>{/each}
		</div>
		<button
			type="button"
			class="act add"
			onclick={() => windows.push({ start: '18:00', end: '18:00' })}
			><Icon name="plus" size={16} />Add window</button
		><label class="row" for="interval"
			><span>Time between slots</span><select
				class="field"
				id="interval"
				name="intervalMinutes"
				value={seed.intervalMinutes}
				>{#each [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240] as interval}<option
						value={interval}>{interval} minutes</option
					>{/each}</select
			></label
		><label class="row" for="gap-policy"
			><span>When a slot is missed</span><select
				class="field"
				id="gap-policy"
				name="gapPolicy"
				value={seed.gapPolicy}
				><option value="keepTimes">Keep times</option><option value="autoFill"
					>Fill gaps</option
				></select
			></label
		>
	</section>
	<section>
		<h2>LinkedIn topics</h2>
		<p class="lede muted">
			One internal topic per line. Your agent reads these instead of your
			Threads topics.
		</p>
		<label class="sr-only" for="topics">LinkedIn topics</label><textarea
			class="field topics"
			id="topics"
			name="topics"
			rows="5"
			value={seed.topics.join('\n')}
			placeholder="Add your own topics"></textarea>
	</section>
	<section>
		<h2>Writing preferences</h2>
		<p class="lede muted">
			Tell your agent what belongs on LinkedIn and what to leave out.
		</p>
		<label class="sr-only" for="instructions"
			>LinkedIn writing preferences</label
		><textarea
			class="field instructions"
			id="instructions"
			name="writingInstructions"
			rows="6"
			maxlength="10000"
			value={seed.writingInstructions}
			placeholder="Your voice, audience, and topics to avoid"></textarea>
	</section>
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	<div class="save">
		<button class="btn btn-primary btn-block">Save LinkedIn preferences</button>
	</div>
</form>
<p class="privacy"><a href="/privacy">Privacy</a></p>

<style>
  details { margin-top: 16px; }
  summary { padding: 8px 0; font-size: 13px; cursor: pointer; }
  .confirm { display: flex; gap: 8px; margin-bottom: 12px; font-size: 13px; }
	section {
		padding: 20px 16px;
		border-bottom: 1px solid var(--line);
	}
	h2 {
		font-size: 17px;
	}
	.lede {
		margin: 4px 0 14px;
		font-size: 13px;
		line-height: 1.5;
	}
	.name {
		margin-top: 12px;
		font-weight: 600;
	}
	.hint {
		margin-top: 12px;
		color: var(--fg-2);
		font-size: 12px;
	}
	.problem,
	.error {
		color: var(--red);
	}
	.success {
		color: var(--green);
		margin-top: 8px;
	}
	.windows {
		display: grid;
		gap: 8px;
	}
	.window {
		display: grid;
		grid-template-columns: 1fr auto 1fr 32px;
		align-items: center;
		gap: 8px;
	}
	.window input {
		min-width: 0;
	}
	.add {
		margin-top: 8px;
	}
	.row {
		display: flex;
		gap: 16px;
		align-items: center;
		justify-content: space-between;
		margin-top: 16px;
		font-size: 13px;
	}
	.row select {
		width: auto;
		max-width: 55%;
	}
	textarea.field {
		display: block;
		width: 100%;
		height: auto;
		padding: 12px;
		resize: vertical;
		line-height: 1.5;
	}
	.save {
		padding: 16px;
	}
	.error {
		padding: 12px 16px;
		font-size: 13px;
	}
	.privacy {
		padding: 8px 16px;
		color: var(--fg-2);
		font-size: 12px;
	}
	.privacy a {
		color: inherit;
		text-underline-offset: 3px;
	}
</style>
