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

	// Posts at off-grid minutes share the nearest cell; the most urgent one colours it.
	const urgency: WeekMark['kind'][] = ['failed', 'held', 'publishing', 'queued', 'published'];
	function byCell(day: number) {
		const cells = new Map<number, WeekMark[]>();
		const all = windows(day).flat();
		if (!all.length) return cells;
		for (const mark of week.marks) {
			if (mark.at < day || mark.at >= calendarDay(day, 1, tz)) continue;
			const nearest = all.reduce((a, b) => (Math.abs(b - mark.at) < Math.abs(a - mark.at) ? b : a));
			cells.set(nearest, [...(cells.get(nearest) ?? []), mark]);
		}
		for (const marks of cells.values()) marks.sort((a, b) => urgency.indexOf(a.kind) - urgency.indexOf(b.kind) || a.at - b.at);
		return cells;
	}
	const firstLine = (mark: WeekMark) => {
		const line = mark.text.split('\n')[0];
		return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
	};
	const describe = (marks: WeekMark[]) =>
		marks.length === 1
			? `${short(marks[0].at)} · ${firstLine(marks[0])}`
			: `${short(marks[0].at)} · ${marks.length} posts`;
	const label = (marks: WeekMark[]) =>
		marks.length === 1
			? describe(marks)
			: `${describe(marks)}: ${marks.map((mark) => `${clock(mark.at)} ${firstLine(mark)}`).join('; ')}`;
	// One post opens that post; a shared cell opens the whole day.
	const cellHref = (marks: WeekMark[]) =>
		marks.length === 1 || linkedin ? markHref(marks[0]) : `/app/schedule?day=${isoDay(marks[0].at)}`;

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

	let tip = $state<{ text: string; x: number; y: number } | null>(null);
	function hover(event: PointerEvent) {
		const cell = (event.target as Element).closest<HTMLElement>('[data-tip]');
		if (!cell) return (tip = null);
		const box = cell.getBoundingClientRect();
		tip = { text: cell.dataset.tip ?? '', x: box.left + box.width / 2, y: box.top };
	}
</script>

<section class="week" aria-label="Week">
	<header>
		<span class="range num">{dayLabel(days[0]).split(' ').slice(1).join(' ')} – {dayLabel(days[6]).split(' ').slice(1).join(' ')}</span>
		<a class="icon-btn" href={withDay(calendarDay(week.day, -7, tz))} aria-label="Previous week"><Icon name="left" size={16} /></a>
		<a class="icon-btn" href={withDay(calendarDay(week.day, 7, tz))} aria-label="Next week"><Icon name="right" size={16} /></a>
	</header>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="grid" onpointerover={hover} onpointerleave={() => (tip = null)}>
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
			{@const count = week.marks.filter((mark) => mark.at >= day && mark.at < calendarDay(day, 1, tz)).length}
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
							{@const marks = cells.get(at)}
							{#if marks}
								<a
									class="cell {tone(marks[0])}"
									class:now={at === lastPast}
									href={cellHref(marks)}
									style:--c={topicColor(marks[0].topic ?? undefined, taxonomy)}
									data-tip={describe(marks)}
									aria-label={label(marks)}
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
	{#if tip}
		<div class="tip" role="tooltip" style:left="{tip.x}px" style:top="{tip.y}px">{tip.text}</div>
	{/if}
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

	.tip {
		position: fixed;
		z-index: 40;
		max-width: 240px;
		padding: 5px 9px;
		overflow: hidden;
		border-radius: 8px;
		background: #0f0f0d;
		color: #f4f3ee;
		font-size: 12px;
		font-weight: 500;
		line-height: 1.35;
		white-space: nowrap;
		text-overflow: ellipsis;
		pointer-events: none;
		transform: translate(-50%, calc(-100% - 6px));
		box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
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
