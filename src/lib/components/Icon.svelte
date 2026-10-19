<script lang="ts" module>
	const paths = {
		drafts: 'M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20V3.5ZM14 3.5V8h4M10 12h5M10 15.5h5',
		schedule: 'M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-10ZM4 10h16M8.5 3v4M15.5 3v4M8 14h.01M12 14h.01M16 14h.01',
		plus: 'M12 5v14M5 12h14',
		replies: 'M20 11.5a7.5 7.5 0 0 1-11 6.63L4.5 19.5l1.4-4.1A7.5 7.5 0 1 1 20 11.5Z',
		library: 'M4 20V9M10 20V4M16 20v-8M21 20H3',
		settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.4 7.4 0 0 1-2 1.2L14.8 21h-4l-.3-2a7.4 7.4 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L4.6 10.3l2-3.4 1.9.7a7.4 7.4 0 0 1 2-1.2L10.8 3h4l.3 2.4a7.4 7.4 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4Z',
		search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20',
		image: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11ZM9 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM20 15l-4.5-4.5L6 20',
		clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
		queue: 'M4 6h12M4 11h12M4 16h7M18 13v7M14.5 16.5h7',
		pin: 'M15 4.5 19.5 9l-3 1-3.5 3.5.5 4-1.5 1.5-3.5-3.5L4.5 19.5M8.5 15.5 5 12l1.5-1.5 4 .5L14 7.5l1-3Z',
		more: 'M5 12h.01M12 12h.01M19 12h.01',
		close: 'M6 6l12 12M18 6 6 18',
		left: 'M15 5l-7 7 7 7',
		right: 'M9 5l7 7-7 7',
		down: 'M6 9l6 6 6-6',
		external: 'M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10',
		swap: 'M7 4 3.5 7.5 7 11M3.5 7.5H16M17 13l3.5 3.5L17 20M20.5 16.5H8',
		move: 'M12 3v18M12 3 8.5 6.5M12 3l3.5 3.5M12 21l-3.5-3.5M12 21l3.5-3.5',
		trash: 'M4 7h16M10 11v6M14 11v6M5.5 7l1 12a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5l1-12M9 7V4.5h6V7',
		edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 7.5l2 2',
		send: 'M20.5 3.5 10 14M20.5 3.5 14 20.5 10 14 3.5 10l17-6.5Z',
		note: 'M5 4.5h14v15H5zM8.5 9h7M8.5 12.5h7M8.5 16h4',
		check: 'M5 12.5l4.5 4.5L19 7',
		alert: 'M12 9v4M12 16.5h.01M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
		undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
		now: 'M13 3 5 13.5h6.5L10.5 21 19 10.5h-6.5L13 3Z',
		eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
		hide: 'M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.9 3.6M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1'
	};
	export type IconName = keyof typeof paths;
</script>

<script lang="ts">
	let { name, size = 20, stroke = 1.75 }: { name: IconName; size?: number; stroke?: number } =
		$props();
</script>

<svg
	class="icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'more'}
		<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
		<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
		<circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
	{:else}
		<path d={paths[name]} />
	{/if}
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
</style>
