<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { dimensions, topicColor, type TaxonomyEntry } from '#lib/labels.ts';
	import { act } from '#lib/toast.svelte.ts';
	import { dayLabel, minutes } from '#lib/time.ts';
	import Icon from '#lib/components/Icon.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
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
		<a class="icon-btn back" href="/schedule" aria-label="Back to schedule"><Icon name="left" /></a>
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
				href="/login"
				data-sveltekit-reload>Reconnect</a
			>
		</div>
	{/if}
</section>

<form method="POST" action="?/save" use:enhance={act()}>
	<section>
		<h2>Posting windows</h2>
		<p class="muted lede">The queue fills free slots inside these windows, in WIB.</p>
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

<style>
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
