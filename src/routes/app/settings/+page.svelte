<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { dimensions, topicColor, type TaxonomyEntry } from '#lib/labels.ts';
	import { act } from '#lib/toast.svelte.ts';
	import { dayLabel, minutes } from '#lib/displayTime.svelte.ts';
	import TimeZoneField from '#lib/components/TimeZoneField.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
  let issuingKey = $state(false);
	const taxonomy = $derived((data.taxonomy ?? []) as TaxonomyEntry[]);
	const seed = untrack(() => data.settings);
	let windows = $state(seed.windows.map((w) => ({ ...w })));
	let interval = $state(seed.intervalMinutes);
	let gapPolicy = $state(seed.gapPolicy);
	const perDay = $derived(
		windows.reduce((sum, w) => {
			const span = minutes(w.end) - minutes(w.start);
			return span >= 0 && interval > 0 ? sum + Math.floor(span / interval) + 1 : sum;
		}, 0)
	);
	const intervals = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
	const account = $derived(data.account);
	const daysLeft = $derived(
		account ? Math.floor((account.tokenExpiresAt - Date.now()) / 86_400_000) : 0
	);
</script>

<svelte:head><title>Settings · antre</title></svelte:head>

<TopBar title="Settings">
	{#snippet lead()}
		<a class="icon-btn back" href="/app/schedule" aria-label="Back to schedule"><Icon name="left" /></a>
	{/snippet}
</TopBar>

<section>
	<h2>Threads account</h2>
	{#if account}
		<div class="account">
			<span class="avatar">{account.username.slice(0, 1).toUpperCase()}</span>
			<div>
				<p><strong>{account.username}</strong></p>
				{#if account.needsReconnect}
					<p class="red">Disconnected. Queued posts are held until you reconnect.</p>
				{:else}
					<p class="muted">
						Access renews automatically · ends {dayLabel(account.tokenExpiresAt)}
						{#if daysLeft <= 7}({daysLeft} days){/if}
					</p>
				{/if}
				{#if account.lastRefreshError}<p class="amber">Last refresh failed: {account.lastRefreshError}</p>{/if}
			</div>
			<a
				class="btn {account.needsReconnect ? 'btn-primary' : 'btn-secondary'} small"
				href="/auth/threads"
				data-sveltekit-reload>Reconnect</a
			>
		</div>
  {:else}
    <p class="muted lede">Connect the profile you want to publish from. You can save drafts before connecting.</p>
    <a class="btn btn-secondary" href="/auth/threads" data-sveltekit-reload>Connect Threads</a>
  {/if}
  {#if account && !account.needsReconnect}
    <details class="lifecycle">
      <summary>Disconnect Threads</summary>
      <form method="POST" action="?/disconnect" use:enhance={act()}>
        <input type="hidden" name="channel" value="threads" />
        <p class="muted lede">Queued posts will wait for this profile to reconnect. Posts already sent stay online. A request in flight may still publish.</p>
        <label class="confirmation"><input type="checkbox" name="confirm" required />Disconnect this posting profile</label>
        <button class="btn btn-secondary">Disconnect Threads</button>
      </form>
    </details>
  {/if}
  <p class="lede"><a href="/app/linkedin/settings">LinkedIn profile and schedule</a></p>
</section>

<form method="POST" action="?/save" use:enhance={act()}>
	<section>
		<h2>Posting windows</h2>
		<p class="muted lede">The queue fills free slots inside these windows.</p>
		<TimeZoneField value={seed.timeZone} id="threads-time-zone" label="Threads time zone" />
		<p class="muted lede">Changing the zone keeps existing queued times fixed.</p>
		<ul class="windows">
			{#each windows as window, index}
				<li>
					<label>
						<span class="sr-only">Window {index + 1} start</span>
						<input class="field" type="time" name="start" bind:value={window.start} required />
					</label>
					<span class="muted">to</span>
					<label>
						<span class="sr-only">Window {index + 1} end</span>
						<input class="field" type="time" name="end" bind:value={window.end} required />
					</label>
					<button
						type="button"
						class="icon-btn"
						aria-label="Remove window {index + 1}"
						disabled={windows.length === 1}
						onclick={() => windows.splice(index, 1)}
					>
						<Icon name="close" size={18} />
					</button>
				</li>
			{/each}
		</ul>
		<button
			type="button"
			class="act add"
			onclick={() => {
				const last = windows.at(-1);
				const start = last ? Math.min(minutes(last.end) + 60, 22 * 60) : 18 * 60;
				const hhmm = (m: number) =>
					`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
				windows.push({ start: hhmm(start), end: hhmm(Math.min(start + 120, 23 * 60 + 59)) });
			}}><Icon name="plus" size={18} />Add window</button
		>

		<label class="row" for="interval">
			<span>Post every</span>
			<select id="interval" class="field select" name="intervalMinutes" bind:value={interval}>
				{#each intervals.includes(interval) ? intervals : [...intervals, interval].sort((a, b) => a - b) as value}
					<option {value}>{value < 60 ? `${value} min` : `${value / 60} h`}</option>
				{/each}
			</select>
		</label>
		<p class="muted capacity num">Up to <strong>{perDay}</strong> posts a day</p>
	</section>

	<section>
		<h2>When a post can’t go out</h2>
		<p class="muted lede">If Threads is disconnected, held posts come back on reconnect.</p>
		<div class="choices">
			<label class="choice">
				<input type="radio" name="gapPolicy" value="autoFill" bind:group={gapPolicy} />
				<span>
					<strong>Fill gaps</strong>
					<span class="muted">Later posts move up into the next free slots. Times you picked stay put.</span>
				</span>
			</label>
			<label class="choice">
				<input type="radio" name="gapPolicy" value="keepTimes" bind:group={gapPolicy} />
				<span>
					<strong>Keep times</strong>
					<span class="muted">Everything keeps its time. A missed post goes out at the same time the next day.</span>
				</span>
			</label>
		</div>
	</section>

	<div class="save">
		<button class="btn btn-primary btn-block">Save schedule</button>
	</div>
</form>

<section>
	<h2>Labels</h2>
	<p class="muted lede">Your agent tags drafts with these. Edit them through the agent’s set_taxonomy tool.</p>
	{#each dimensions as dimension}
		{@const entries = taxonomy.filter((entry) => entry.dimension === dimension)}
		<h3>{dimension[0].toUpperCase() + dimension.slice(1)}</h3>
		{#if entries.length}
			<ul class="taxonomy">
				{#each entries as entry (entry.code)}
					<li>
						{#if dimension === 'topic'}<i class="dot" style:--c={topicColor(entry.code, taxonomy)}></i>{/if}
						<span class="code num">{entry.code}</span>
						<span>
							{entry.name}
							{#if entry.description}<span class="desc">{entry.description}</span>{/if}
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">None yet.</p>
		{/if}
	{/each}
</section>

{#if form?.error}<p class="action-error" role="alert">{form.error}</p>{/if}
<section>
  <h2>Workspace time zone</h2>
  <p class="muted lede">New channel schedules start with this zone. Existing channel schedules keep their own zone.</p>
  <form method="POST" action="?/timeZone" use:enhance={act()}>
    <TimeZoneField value={data.workspace.timeZone} id="workspace-time-zone" />
    <button class="btn btn-secondary spaced">Save workspace time zone</button>
  </form>
</section>

<section>
  <h2>Agent keys</h2>
  <p class="muted lede">Each key gives an agent access to this workspace through MCP, including publishing and deleting drafts. Revoke a key to stop its next request.</p>
  <p class="endpoint">MCP endpoint: <code>{data.mcpUrl}</code></p>
  {#if form && 'agentToken' in form && form.agentToken}
    <div class="new-key" role="status">
      <p><strong>Copy this key now.</strong> It is shown once. Use it as your MCP bearer token.</p>
      <code class="token">{form.agentToken}</code>
    </div>
  {/if}
  <form method="POST" action="?/createAgent" use:enhance={() => {
    issuingKey = true;
    return async ({ update }) => { try { await update({ reset: false }); } finally { issuingKey = false; } };
  }}>
    <label class="field-label" for="agent-label">Key name</label>
    <input class="field" id="agent-label" name="label" maxlength="80" placeholder="My writing agent" required />
    <button class="btn btn-secondary spaced" disabled={issuingKey}>{issuingKey ? 'Creating key…' : 'Create agent key'}</button>
  </form>
  <ul class="grants">
    {#each data.agentGrants as grant (grant._id)}
      <li><span>{grant.label}{#if grant.revokedAt}<span class="muted"> · revoked</span>{/if}</span>
        {#if !grant.revokedAt}<form method="POST" action="?/revokeAgent" use:enhance={act()}>
          <input type="hidden" name="id" value={grant._id} />
          <button class="btn btn-secondary small">Revoke</button>
        </form>{/if}
      </li>
    {:else}<li class="muted">No agent keys. Create one to connect your agent.</li>{/each}
  </ul>
</section>

<section>
  <h2>Your account</h2>
  <p class="muted lede">Signing out ends this browser session. Scheduled posts keep publishing.</p>
  <form method="POST" action="/logout"><button class="btn btn-secondary">Sign out</button></form>
  <details class="lifecycle">
    <summary>Delete workspace</summary>
    <form method="POST" action="?/deleteWorkspace" use:enhance>
      <p class="muted lede">This deletes your drafts, schedules, replies, media, posting credentials, and agent keys. It stops queued posts. Posts already published on Threads or LinkedIn stay online. A request in flight may still publish.</p>
      <label class="field-label" for="delete-confirmation">Type DELETE to delete this workspace</label>
      <input class="field" id="delete-confirmation" name="confirmation" pattern="DELETE" required autocomplete="off" />
      <button class="btn btn-secondary spaced danger">Delete workspace</button>
    </form>
  </details>
  <p class="spaced"><a href="/privacy">Privacy</a></p>
</section>

<style>
  .spaced { margin-top: 12px; }
  .field-label { display: block; margin: 12px 0 6px; font-size: 13px; font-weight: 600; }
  .lifecycle { margin-top: 20px; }
  .lifecycle summary { padding: 8px 0; cursor: pointer; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
  .confirmation { display: flex; align-items: start; gap: 8px; margin-bottom: 12px; font-size: 13px; }
  .grants { padding: 0; margin: 16px 0 0; list-style: none; }
  .grants li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 13px; overflow-wrap: anywhere; }
  .grants li > span { min-width: 0; }
  .new-key { margin: 16px 0; font-size: 13px; }
  .token { display: block; margin-top: 8px; padding: 12px; background: var(--bg-2); overflow-wrap: anywhere; user-select: all; }
  .endpoint { margin-bottom: 16px; font-size: 13px; overflow-wrap: anywhere; }
  .danger, .action-error { color: var(--red); }
  .action-error { padding: 16px; }
	.back {
		margin-left: -8px;
	}

	section {
		padding: 20px 16px;
		border-bottom: 1px solid var(--line);
	}

	h2 {
		font-size: 17px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	h3 {
		margin: 16px 0 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--fg-2);
	}

	.lede {
		margin: 2px 0 14px;
		font-size: 13px;
		line-height: 18px;
	}

	.account {
		display: grid;
		grid-template-columns: 40px 1fr auto;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
		font-size: 13px;
		line-height: 18px;
	}

	.account strong {
		font-size: 15px;
		font-weight: 600;
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--fg);
		color: var(--on-fg);
		font-weight: 700;
	}

	.red {
		color: var(--red);
	}

	.amber {
		color: var(--amber);
	}

	.small {
		height: 32px;
		padding: 0 14px;
		font-size: 13px;
	}

	.windows {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.windows li {
		display: grid;
		grid-template-columns: 1fr auto 1fr 36px;
		align-items: center;
		gap: 8px;
	}

	.add {
		margin-top: 8px;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 20px;
		font-weight: 500;
	}

	.select {
		width: auto;
		min-width: 110px;
	}

	.capacity {
		margin-top: 6px;
		font-size: 13px;
	}

	.capacity strong {
		color: var(--fg);
	}

	.choices {
		display: grid;
		gap: 8px;
	}

	.choice {
		display: grid;
		grid-template-columns: 20px 1fr;
		gap: 10px;
		padding: 12px;
		border: 1px solid var(--line-2);
		border-radius: 12px;
		cursor: pointer;
	}

	.choice:has(input:checked) {
		border-color: var(--fg);
		box-shadow: inset 0 0 0 0.5px var(--fg);
	}

	.choice input {
		margin: 2px 0 0;
		accent-color: var(--fg);
	}

	.choice > span {
		display: grid;
		gap: 2px;
	}

	.choice strong {
		font-weight: 600;
	}

	.choice .muted {
		font-size: 13px;
		line-height: 18px;
	}

	.save {
		padding: 16px;
		border-bottom: 1px solid var(--line);
	}

	.taxonomy {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.taxonomy li {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 6px 0;
		font-size: 14px;
		line-height: 20px;
	}

	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
	}

	.code {
		flex: none;
		width: 36px;
		font-size: 12px;
		color: var(--fg-2);
	}

	.desc {
		display: block;
		font-size: 12px;
		line-height: 16px;
		color: var(--fg-2);
	}
</style>
