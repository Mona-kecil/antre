<script lang="ts">
	import { page } from '$app/state';
	import { calendarDay } from '#lib/calendar.ts';
	import { clock, dayLabel, isoDay, slots } from '#lib/displayTime.svelte.ts';
	import { topicColor, type TaxonomyEntry } from '#lib/labels.ts';
	import type { Week, WeekMark } from '#lib/week.ts';
	import Icon from './Icon.svelte';

	let { week, now }: { week: Week; now: number } = $props();
	const taxonomy = $derived((page.data.taxonomy ?? []) as TaxonomyEntry[]);
	const linkedin = $derived(week.channel === 'linkedin');
	const step = $derived(week.settings.intervalMinutes * 60_000);
	const end = $derived(calendarDay(week.day, 1, week.settings.timeZone));
	const posts = $derived(week.marks.filter((mark) => mark.at >= week.day && mark.at < end).sort((a, b) => a.at - b.at));
	const times = $derived(
		[...new Set([...slots(week.day, week.settings), ...posts.map((mark) => mark.at)])].sort((a, b) => a - b)
	);
	const free = $derived(times.filter((at) => at > now && !posts.some((mark) => mark.at === at)));
	type Row =
		| { type: 'gap' }
		| { type: 'now' }
		| { type: 'slot'; at: number; marks: WeekMark[] };
	const rows = $derived.by(() => {
		const out: Row[] = [];
		let nowShown = week.day !== week.today;
		times.forEach((at, i) => {
			if (i > 0 && at - times[i - 1] > step) out.push({ type: 'gap' });
			if (!nowShown && at > now) {
				out.push({ type: 'now' });
				nowShown = true;
			}
			out.push({ type: 'slot', at, marks: posts.filter((mark) => mark.at === at) });
		});
		if (!nowShown) out.push({ type: 'now' });
		return out;
	});
	const markHref = (mark: WeekMark) =>
		linkedin
			? `/app/linkedin?view=${mark.kind === 'published' ? 'published' : mark.kind === 'failed' ? 'failed' : 'scheduled'}`
			: `/app/schedule?day=${isoDay(mark.at)}#post-${mark.id}`;
	const freeHref = (at: number) => `${linkedin ? '/app/linkedin/compose' : '/app/compose'}?at=${at}`;
</script>

<section class="agenda" aria-label="Day">
	<h2>
		{week.day === week.today ? 'Today' : dayLabel(week.day)}
		{#if week.day === week.today}<span class="muted">{dayLabel(week.day)}</span>{/if}
	</h2>
	<p class="sum muted num">
		<b>{posts.length}</b>
		{posts.length === 1 ? 'post' : 'posts'} · <b>{free.length}</b> free
	</p>
	<ol>
		{#each rows as row}
			{#if row.type === 'gap'}
				<li class="gap" aria-hidden="true"></li>
			{:else if row.type === 'now'}
				<li class="now num"><span>{clock(now)}</span><i></i></li>
			{:else}
				<li class="slot">
					<time class="num" datetime={new Date(row.at).toISOString()}>{clock(row.at)}</time>
					<div>
						{#each row.marks as mark}
							<a
								class="post {mark.kind}"
								class:pinned={mark.pinned}
								href={markHref(mark)}
							>
								<i class="dot" style:--c={topicColor(mark.topic ?? undefined, taxonomy)}></i>
								<span class="text">{mark.text.split('\n')[0]}</span>
								{#if mark.kind === 'published'}<Icon name="check" size={14} />
								{:else if mark.kind === 'failed' || mark.kind === 'held'}<Icon name="alert" size={14} />
								{:else if mark.pinned}<Icon name="pin" size={14} />{/if}
							</a>
						{:else}
							{#if row.at > now}
								<a class="free" href={freeHref(row.at)}>Free</a>
							{:else}
								<span class="gone">–</span>
							{/if}
						{/each}
					</div>
				</li>
			{/if}
		{/each}
	</ol>
</section>

<style>
	h2 {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 15px;
		font-weight: 700;
	}

	h2 .muted {
		font-size: 12.5px;
		font-weight: 500;
	}

	.sum {
		margin-top: 4px;
		font-size: 12px;
	}

	.sum b {
		color: var(--fg);
		font-weight: 600;
	}

	ol {
		display: grid;
		gap: 3px;
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
	}

	.slot {
		display: grid;
		grid-template-columns: 40px minmax(0, 1fr);
		gap: 10px;
		align-items: center;
		min-height: 32px;
		font-size: 13px;
	}

	.slot > div {
		display: grid;
		gap: 3px;
		min-width: 0;
	}

	time {
		font-size: 12px;
		color: var(--fg-2);
	}

	.gap {
		min-height: 10px;
		margin-bottom: 8px;
		border-bottom: 1px dashed var(--line-2);
	}

	.now {
		display: grid;
		grid-template-columns: 40px 1fr;
		gap: 10px;
		align-items: center;
		margin: 2px 0;
		font-size: 11px;
		font-weight: 650;
		color: var(--red);
	}

	.now i {
		height: 1.5px;
		background: var(--red);
	}

	.post {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 6px 10px;
		border-radius: 10px;
		background: var(--bg);
		box-shadow: 0 0 0 1px var(--line);
		color: var(--fg);
		text-decoration: none;
	}

	.post:hover {
		box-shadow: 0 0 0 1px var(--line-2);
	}

	.post.published {
		opacity: 0.62;
	}

	.post.failed {
		box-shadow: 0 0 0 1.5px var(--red);
	}

	.post.held {
		box-shadow: 0 0 0 1.5px var(--amber);
	}

	.text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
	}

	.free {
		padding: 6px 10px;
		border: 1px dashed var(--line-2);
		border-radius: 10px;
		color: var(--fg-2);
		font-size: 12.5px;
		text-decoration: none;
	}

	.free:hover {
		border-color: var(--fg);
		color: var(--fg);
	}

	.gone {
		padding-left: 10px;
		font-size: 12px;
		color: var(--fg-3);
	}
</style>
