<script lang="ts">
	import { untrack } from 'svelte';
	import { minutes } from '#lib/time.ts';
	import Icon from '../components/Icon.svelte';
	import TopBar from '../components/TopBar.svelte';
	import { names } from './fixtures';
	import { href, type Sandbox } from './sandbox.svelte';

	let { sandbox }: { sandbox: Sandbox } = $props();
	// The workspace keys this view by URL, so the first channel is the only one.
	const channel = untrack(() => sandbox.route.channel);
	const seed = untrack(() => sandbox.settings);
	const other = channel === 'threads' ? 'linkedin' : 'threads';
	const label = { threads: 'Threads', linkedin: 'LinkedIn' };
	let windows = $state(seed.windows.map((w) => ({ ...w })));
	let interval = $state(seed.intervalMinutes);
	const perDay = $derived(
		windows.reduce((sum, w) => {
			const span = minutes(w.end) - minutes(w.start);
			return span >= 0 && interval > 0 ? sum + Math.floor(span / interval) + 1 : sum;
		}, 0)
	);
	const intervals = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
	const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
</script>

<TopBar title="Settings" heading="h2">
	{#snippet lead()}
		<a class="icon-btn back" href={href(channel, 'schedule')} aria-label="Back to schedule"><Icon name="left" /></a>
	{/snippet}
</TopBar>

<section>
	<h3>{channel === 'threads' ? 'Threads account' : 'LinkedIn profile'}</h3>
	<div class="account">
		<span class="avatar">{names[channel].slice(0, 1).toUpperCase()}</span>
		<p><strong>{names[channel]}</strong></p>
	</div>
	<p class="lede"><a href={href(other, 'settings')}>{label[other]} profile and schedule</a></p>
</section>

<form
	onsubmit={(event) => {
		event.preventDefault();
		sandbox.act((store) => (store.updateSettings(channel, { windows, intervalMinutes: interval, timeZone: seed.timeZone }), 'Saved'));
	}}
>
	<section>
		<h3>Posting windows</h3>
		<p class="muted lede">The queue fills free slots inside these windows · {seed.timeZone}</p>
		<ul class="windows">
			{#each windows as window, index}
				<li>
					<label>
						<span class="sr-only">Window {index + 1} start</span>
						<input class="field" type="time" bind:value={window.start} required />
					</label>
					<span class="muted">to</span>
					<label>
						<span class="sr-only">Window {index + 1} end</span>
						<input class="field" type="time" bind:value={window.end} required />
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
				windows.push({ start: hhmm(start), end: hhmm(Math.min(start + 120, 23 * 60 + 59)) });
			}}><Icon name="plus" size={18} />Add window</button
		>

		<label class="row" for="sample-interval">
			<span>Post every</span>
			<select id="sample-interval" class="field select" bind:value={interval}>
				{#each intervals as value}
					<option {value}>{value < 60 ? `${value} min` : `${value / 60} h`}</option>
				{/each}
			</select>
		</label>
		<p class="muted capacity num">Up to <strong>{perDay}</strong> posts a day</p>
	</section>
	<div class="save"><button class="btn btn-primary btn-block">Save</button></div>
</form>

<section>
	<h3>Agent keys</h3>
	<p class="muted lede">
		Your agent writes drafts over MCP with a key. A key can also queue, publish, and delete posts, and send replies.
		Revoke it in Settings to stop its next request.
	</p>
	<a class="btn btn-secondary" href="/login?screen_hint=sign-up">Create account</a>
</section>

<style>
	.back {
		margin-left: -8px;
	}

	section {
		padding: 20px 16px;
		border-bottom: 1px solid var(--line);
	}

	h3 {
		font-size: 17px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.lede {
		margin: 2px 0 14px;
		font-size: 13px;
		line-height: 18px;
	}

	.account {
		display: grid;
		grid-template-columns: 40px 1fr;
		align-items: center;
		gap: 12px;
		margin: 12px 0 16px;
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
		background: var(--primary);
		color: var(--on-primary);
		font-weight: 700;
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

	.save {
		padding: 16px;
		border-bottom: 1px solid var(--line);
	}
</style>
