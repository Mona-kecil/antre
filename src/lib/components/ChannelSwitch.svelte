<script lang="ts">
	import { page } from '$app/state';
	const linkedin = $derived(page.url.pathname.startsWith('/app/linkedin'));
	const section = $derived(
		page.url.pathname.endsWith('/settings')
			? 'settings'
			: page.url.pathname === '/app/schedule' ||
				  page.url.searchParams.get('view') === 'scheduled'
				? 'schedule'
				: page.url.pathname === '/app/library' ||
					  page.url.searchParams.get('view') === 'published'
					? 'library'
					: 'drafts'
	);
	const threadsHref = $derived(section === 'drafts' ? '/app' : `/app/${section}`);
	const linkedinHref = $derived(
		section === 'settings'
			? '/app/linkedin/settings'
			: section === 'schedule'
				? '/app/linkedin?view=scheduled'
				: section === 'library'
					? '/app/linkedin?view=published'
					: '/app/linkedin'
	);
</script>

<nav aria-label="Posting channel">
	<a href={threadsHref} aria-current={!linkedin ? 'true' : undefined}>Threads</a
	>
	<a href={linkedinHref} aria-current={linkedin ? 'true' : undefined}
		>LinkedIn</a
	>
</nav>

<style>
	nav {
		display: flex;
		gap: 2px;
		padding: 3px;
		background: var(--bg-2);
		border-radius: 8px;
	}
	a {
		display: grid;
		place-items: center;
		min-height: 34px;
		padding: 0 9px;
		color: var(--fg-2);
		font-size: 12px;
		font-weight: 600;
		text-decoration: none;
		border-radius: 8px;
	}
	a[aria-current] {
		background: var(--bg);
		color: var(--fg);
	}
	a:focus-visible {
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
</style>
