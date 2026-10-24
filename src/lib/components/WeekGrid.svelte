<script lang="ts">
	import { page } from '$app/state';
	import { calendarDay } from '#lib/calendar.ts';
	import { clock, dayLabel, isoDay, slots } from '#lib/displayTime.svelte.ts';
	import { topicColor, type TaxonomyEntry } from '#lib/labels.ts';
	import type { Week, WeekMark } from '#lib/week.ts';
	import Icon from './Icon.svelte';

	let { week, now }: { week: Week; now: number } = $props();
	const taxonomy = $derived((page.data.taxonomy ?? []) as TaxonomyEntry[]);
	const tz = $derived(week.settings.timeZone);
	const days = $derived(Array.from({ length: 7 }, (_, i) => calendarDay(week.from, i, tz)));
	const step = $derived(week.settings.intervalMinutes * 60_000);
	const linkedin = $derived(week.channel === 'linkedin');

	// Slots split into posting windows wherever the gap is wider than one interval.
	function windows(day: number) {
		const groups: number[][] = [];
		for (const at of slots(day, week.settings)) {
			const last = groups.at(-1);
			if (last && at - last[last.length - 1] === step) last.push(at);
			else groups.push([at]);
		}
		return groups;
	}

	function byCell(day: number) {
		const cells = new Map<number, WeekMark>();
		const all = windows(day).flat();
		for (const mark of week.marks) {
			if (mark.at < day || mark.at >= calendarDay(day, 1, tz)) continue;
			const nearest = all.reduce((a, b) => (Math.abs(b - mark.at) < Math.abs(a - mark.at) ? b : a), all[0]);
			if (nearest !== undefined && !cells.has(nearest)) cells.set(nearest, mark);
		}
		return cells;
	}

	function withDay(day: number) {
		const url = new URL(page.url.href);
		url.searchParams.delete('page');
		if (day === week.today) url.searchParams.delete('day');
		else url.searchParams.set('day', isoDay(day));
		return url.pathname + url.search;
	}

	const markHref = (mark: WeekMark) =>
		linkedin
			? `/app/linkedin?view=${mark.kind === 'published' ? 'published' : mark.kind === 'failed' ? 'failed' : 'scheduled'}`
			: `/app/schedule?day=${isoDay(mark.at)}#post-${mark.id}`;
	const freeHref = (at: number) => `${linkedin ? '/app/linkedin/compose' : '/app/compose'}?at=${at}`;
	const tone = (mark: WeekMark) =>
		mark.kind === 'published' ? 'pub' : mark.kind === 'failed' ? 'fail' : mark.kind === 'held' ? 'held' : 'queued';
	const short = (at: number) => `${dayLabel(at).split(' ')[0]} ${clock(at)}`;
	const axis = $derived(windows(week.from));
</script>

<section class="week" aria-label="Week">
	<header>
		<span class="range num">{dayLabel(days[0]).split(' ').slice(1).join(' ')} – {dayLabel(days[6]).split(' ').slice(1).join(' ')}</span>
		<a class="icon-btn" href={withDay(calendarDay(week.day, -7, tz))} aria-label="Previous week"><Icon name="left" size={16} /></a>
		<a class="icon-btn" href={withDay(calendarDay(week.day, 7, tz))} aria-label="Next week"><Icon name="right" size={16} /></a>
	</header>
	<div class="grid">
		<div class="col axis" aria-hidden="true">
			<span class="head"></span>
			{#each axis as group}
				<span class="win">
					{#each group as at, i}<i>{i === 0 ? Number(clock(at).slice(0, 2)) : ''}</i>{/each}
				</span>
			{/each}
		</div>
		{#each days as day}
			{@const cells = byCell(day)}
			{@const count = [...cells.values()].length}
			{@const lastPast = day === week.today ? windows(day).flat().filter((at) => at <= now).at(-1) : undefined}
			<div class="col" class:on={day === week.day} class:today={day === week.today} class:past={day < week.today}>
				<a
					class="head"
					href={withDay(day)}
					aria-label="{dayLabel(day)}, {count} {count === 1 ? 'post' : 'posts'}"
					aria-current={day === week.day ? 'date' : undefined}
				>
					<span class="dow">{dayLabel(day).slice(0, 2)}</span>
					<span class="date num">{dayLabel(day).split(' ')[1]}</span>
				</a>
				{#each windows(day) as group}
					<span class="win">
						{#each group as at}
							{@const mark = cells.get(at)}
							{#if mark}
								<a
									class="cell {tone(mark)}"
									class:now={at === lastPast}
									href={markHref(mark)}
									style:--c={topicColor(mark.topic ?? undefined, taxonomy)}
									data-tip="{short(at)} · {mark.text.split('\n')[0]}"
									aria-label="{short(at)}, {mark.text.split('\n')[0]}"
								></a>
							{:else if at > now}
								<a
									class="cell free"
									class:next={at === week.nextSlot}
									class:now={at === lastPast}
									href={freeHref(at)}
									data-tip="{short(at)} · Free"
									aria-label="{short(at)}, free. Write a post for this time"
								></a>
							{:else}
								<i class="cell gone" class:now={at === lastPast}></i>
							{/if}
						{/each}
					</span>
				{/each}
			</div>
		{/each}
	</div>
	<p class="sum muted num">
		<b>{week.marks.length}</b>
		{week.marks.length === 1 ? 'post' : 'posts'}
		{#if week.nextSlot}· next <b>{week.nextSlot - week.today < 86_400_000 ? clock(week.nextSlot) : short(week.nextSlot)}</b>{/if}
	</p>
</section>

<style>
	.week {
		padding-top: 14px;
		border-top: 1px solid var(--line);
	}

	header {
		display: flex;
		align-items: center;
		gap: 2px;
		margin-bottom: 6px;
		padding-left: 4px;
		font-size: 12px;
		color: var(--fg-2);
	}

	.range {
		margin-right: auto;
	}

	header .icon-btn {
		width: 26px;
		height: 26px;
		color: var(--fg-2);
	}

	.grid {
		display: grid;
		grid-template-columns: 20px repeat(7, minmax(0, 1fr));
		gap: 3px;
	}

	.col {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: 6px;
		min-width: 0;
		padding: 0 2px 4px;
		border-radius: 8px;
	}

	.col.axis {
		padding: 0;
	}

	.col:not(.axis):hover {
		background: var(--press);
	}

	.col.on {
		background: color-mix(in srgb, var(--primary) 22%, transparent);
	}

	.head {
		display: grid;
		justify-items: center;
		min-height: 36px;
		padding: 4px 0 2px;
		color: var(--fg);
		text-decoration: none;
	}

	.dow {
		font-size: 10.5px;
		color: var(--fg-2);
	}

	.date {
		font-size: 13px;
		font-weight: 600;
	}

	.past .date {
		color: var(--fg-2);
		font-weight: 500;
	}

	.today .dow {
		color: var(--fg);
		font-weight: 700;
	}

	.win {
		display: grid;
		gap: 2px;
	}

	.cell {
		position: relative;
		display: block;
		height: 7px;
		border-radius: 2px;
		background: var(--bg-2);
	}

	.axis i {
		font-size: 10px;
		line-height: 7px;
		font-style: normal;
		color: var(--fg-2);
		text-align: right;
		padding-right: 3px;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.cell.queued {
		background: var(--c);
	}

	.cell.pub {
		background: var(--fg-2);
		opacity: 0.55;
	}

	.cell.fail {
		background: var(--red);
	}

	.cell.held {
		background: var(--amber);
	}

	.cell.gone {
		opacity: 0.4;
	}

	.cell.free:hover {
		box-shadow: inset 0 0 0 1.5px var(--fg);
	}

	.cell.next {
		background: transparent;
		box-shadow: inset 0 0 0 1.5px var(--fg);
	}

	.cell.now::after {
		content: '';
		position: absolute;
		left: -3px;
		right: -3px;
		bottom: -2.5px;
		height: 1.5px;
		border-radius: 1px;
		background: var(--red);
	}

	.sum {
		margin: 8px 4px 0;
		font-size: 12px;
	}

	.sum b {
		color: var(--fg);
		font-weight: 600;
	}
</style>
