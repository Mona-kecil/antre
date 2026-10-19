<script lang="ts">
	import { clock, minutes, slots } from '#lib/time.ts';

	type Mark = { id: string; at: number; kind: string; color: string };
	let {
		day,
		settings,
		posts,
		now,
		nextSlot,
		selected = null,
		onselect
	}: {
		day: number;
		settings: { windows: { start: string; end: string }[]; intervalMinutes: number };
		posts: Mark[];
		now: number;
		nextSlot: number | null;
		selected?: string | null;
		onselect: (id: string) => void;
	} = $props();

	const H = 84;
	const Y = 42;
	const PAD = 16;
	let width = $state(358);
	let scrub = $state<number | null>(null);

	const span = $derived.by(() => {
		const ends = settings.windows.flatMap((w) => [minutes(w.start), minutes(w.end)]);
		const times = posts.map((post) => (post.at - day) / 60_000);
		const lo = Math.min(...ends, ...times);
		const hi = Math.max(...ends, ...times);
		const pad = Math.max(settings.intervalMinutes / 2, 10);
		return { from: day + (lo - pad) * 60_000, to: day + (hi + pad) * 60_000 };
	});
	const x = (at: number) =>
		PAD + ((at - span.from) / (span.to - span.from)) * (width - PAD * 2);
	const timeAt = (px: number) =>
		span.from + ((px - PAD) / (width - PAD * 2)) * (span.to - span.from);

	const pitch = $derived(x(span.from + settings.intervalMinutes * 60_000) - x(span.from));
	const bar = $derived(Math.max(3, Math.min(12, pitch * 0.62)));
	const taken = $derived(new Set(posts.map((post) => post.at)));
	const free = $derived(slots(day, settings).filter((at) => at > now && !taken.has(at)));
	const showFree = $derived(pitch >= 5);
	const tracks = $derived(
		settings.windows.map((w) => ({
			start: day + minutes(w.start) * 60_000,
			end: day + minutes(w.end) * 60_000
		}))
	);
	const index = $derived(posts.findIndex((post) => post.id === selected));
	const current = $derived(posts[index]);

	function nearest(at: number) {
		let best: Mark | undefined;
		for (const post of posts)
			if (!best || Math.abs(post.at - at) < Math.abs(best.at - at)) best = post;
		return best;
	}

	function point(event: PointerEvent) {
		const box = (event.currentTarget as SVGElement).getBoundingClientRect();
		return Math.max(span.from, Math.min(span.to, timeAt(event.clientX - box.left)));
	}

	function key(event: KeyboardEvent) {
		if (!posts.length) return;
		const step = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[event.key];
		if (step === undefined) return;
		event.preventDefault();
		const from = index < 0 ? (step > 0 ? -1 : posts.length) : index;
		const to = Math.max(0, Math.min(posts.length - 1, from + step));
		onselect(posts[to].id);
	}
</script>

<div class="dayline" bind:clientWidth={width}>
	<svg
		viewBox={`0 0 ${width} ${H}`}
		{width}
		height={H}
		role="slider"
		tabindex="0"
		aria-label="Posts on this day"
		aria-valuemin={0}
		aria-valuemax={posts.length}
		aria-valuenow={index + 1}
		aria-valuetext={current ? `${clock(current.at)}, post ${index + 1} of ${posts.length}` : 'No post selected'}
		onkeydown={key}
		onpointerdown={(event) => {
			(event.currentTarget as SVGElement).setPointerCapture(event.pointerId);
			scrub = point(event);
		}}
		onpointermove={(event) => {
			if (scrub !== null) scrub = point(event);
		}}
		onpointerup={() => {
			if (scrub === null) return;
			const hit = nearest(scrub);
			scrub = null;
			if (hit) onselect(hit.id);
		}}
		onpointercancel={() => (scrub = null)}
	>
		{#each tracks as track}
			<rect
				class="track"
				x={x(track.start) - 4}
				y={Y - 4}
				width={x(track.end) - x(track.start) + 8}
				height="8"
				rx="4"
			/>
			<text class="hour" x={x(track.start)} y={H - 6} text-anchor="middle">{clock(track.start)}</text>
			{#if track.end - track.start > settings.intervalMinutes * 60_000}
				<text class="hour" x={x(track.end)} y={H - 6} text-anchor="middle">{clock(track.end)}</text>
			{/if}
		{/each}

		{#if showFree}
			{#each free as at}
				<circle class="free" cx={x(at)} cy={Y} r="2" />
			{/each}
		{/if}

		{#if now > span.from && now < span.to}
			<line class="now" x1={x(now)} x2={x(now)} y1={Y - 16} y2={Y + 7} />
			<circle class="now-dot" cx={x(now)} cy={Y - 16} r="2.5" />
		{/if}

		{#if nextSlot !== null && nextSlot > span.from && nextSlot < span.to}
			<circle class="next" cx={x(nextSlot)} cy={Y} r="5" />
			<text class="next-label" x={x(nextSlot)} y={Y + 20} text-anchor="middle">Next</text>
		{/if}

		{#each posts as post (post.id)}
			{@const on = post.id === selected}
			{@const h = on ? 26 : 14}
			<rect
				class="post {post.kind}"
				class:on
				x={x(post.at) - bar / 2}
				y={Y - h / 2}
				width={bar}
				height={h}
				rx={Math.min(bar, h) / 2}
				style:--c={post.color}
			/>
		{/each}

		{#if scrub !== null}
			<line class="scrub" x1={x(scrub)} x2={x(scrub)} y1="16" y2={Y + 14} />
			<text class="readout num" x={Math.max(22, Math.min(width - 22, x(scrub)))} y="12" text-anchor="middle">
				{clock(scrub)}
			</text>
		{:else if current}
			<text class="readout num" x={Math.max(22, Math.min(width - 22, x(current.at)))} y="12" text-anchor="middle">
				{clock(current.at)}
			</text>
		{/if}
	</svg>
</div>

<style>
	.dayline {
		position: sticky;
		top: var(--bar);
		z-index: 4;
		height: 84px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}

	svg {
		display: block;
		touch-action: pan-y;
		cursor: ew-resize;
		user-select: none;
		-webkit-user-select: none;
	}

	svg:focus-visible {
		outline: 2px solid var(--indigo);
		outline-offset: -2px;
	}

	.track {
		fill: var(--bg-2);
	}

	.hour,
	.next-label {
		font-size: 11px;
		fill: var(--fg-2);
		font-variant-numeric: tabular-nums;
	}

	.next-label {
		font-weight: 600;
		fill: var(--fg);
	}

	.free {
		fill: var(--bg);
		stroke: var(--fg-3);
		stroke-width: 1;
	}

	.now {
		stroke: var(--red);
		stroke-width: 1.5;
	}

	.now-dot {
		fill: var(--red);
	}

	.next {
		fill: none;
		stroke: var(--fg);
		stroke-width: 1.5;
	}

	.post {
		fill: var(--c);
		transition:
			y 260ms var(--ease),
			height 260ms var(--ease);
	}

	.post.published {
		opacity: 0.35;
	}

	.post.held {
		fill: var(--bg);
		stroke: var(--amber);
		stroke-width: 2;
	}

	.post.failed {
		fill: var(--red);
	}

	.post.publishing {
		opacity: 0.7;
	}

	.post.on {
		stroke: var(--fg);
		stroke-width: 1.5;
		paint-order: stroke;
	}

	.scrub {
		stroke: var(--fg);
		stroke-width: 1;
		stroke-dasharray: 2 2;
	}

	.readout {
		font-size: 12px;
		font-weight: 600;
		fill: var(--fg);
		font-variant-numeric: tabular-nums;
	}

	@media (prefers-reduced-motion: reduce) {
		.post {
			transition: none;
		}
	}
</style>
