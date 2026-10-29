import { ZodError } from 'zod';
import { calendarDay, calendarDistance } from '#lib/calendar.ts';
import { dayStart, parseDay } from '#lib/time.ts';
import type { Week } from '#lib/week.ts';
import { sampleStart } from './fixtures';
import { DemoStore, type Channel } from './store';

export type Route =
	| { name: 'drafts' | 'schedule' | 'library' | 'settings'; channel: Channel }
	| { name: 'replies'; channel: 'threads' }
	| { name: 'compose'; channel: Channel; at: number | null; edit: string | null };

/** Maps an /app URL to the sample view that stands in for that page. */
export function route(url: URL): Route {
	const linkedin = url.pathname.startsWith('/app/linkedin');
	const channel: Channel = linkedin ? 'linkedin' : 'threads';
	const rest = url.pathname.slice(linkedin ? '/app/linkedin'.length : '/app'.length).replace(/\/$/, '');
	const view = url.searchParams.get('view');
	if (rest === '/compose')
		return { name: 'compose', channel, at: Number(url.searchParams.get('at')) || null, edit: url.searchParams.get('edit') };
	if (rest === '/settings') return { name: 'settings', channel };
	if (rest === '/replies' && !linkedin) return { name: 'replies', channel: 'threads' };
	if (rest === '/library' || view === 'published') return { name: 'library', channel };
	if (rest === '/schedule' || view === 'scheduled') return { name: 'schedule', channel };
	return { name: 'drafts', channel };
}

/** The live state behind the sample workspace: a local store, a local URL, and the toast. */
export class Sandbox {
	#started = Date.now();
	#base = sampleStart(this.#started);
	#clock = () => this.#base + (Date.now() - this.#started);
	#store = new DemoStore({ now: this.#clock });
	#timer: ReturnType<typeof setTimeout> | undefined;
	state = $state(this.#store.state);
	url = $state(new URL('/app', 'https://sample.invalid'));
	toast = $state<{ id: number; text: string; error: boolean } | null>(null);
	/** The post that just took a slot, so the week and agenda can point at it. */
	fresh = $state<{ id: string; n: number } | null>(null);

	constructor(origin: string) {
		this.url = new URL('/app', origin);
	}

	// Re-read the clock whenever the sample changes, the way the app does when fresh data arrives.
	now = $derived.by(() => {
		void this.state;
		void this.url;
		return this.#clock();
	});
	route = $derived(route(this.url));
	settings = $derived(this.state.settings[this.route.channel]);
	today = $derived(dayStart(this.now, this.settings.timeZone));
	day = $derived(parseDay(this.url.searchParams.get('day'), this.settings.timeZone) ?? this.today);
	posts = $derived(this.state.posts.filter((post) => post.channel === this.route.channel));
	nextSlot = $derived.by(() => {
		void this.state;
		return this.#store.next(this.route.channel);
	});
	week: Week = $derived.by(() => {
		const tz = this.settings.timeZone;
		return {
			channel: this.route.channel,
			from: calendarDay(this.today, Math.floor(calendarDistance(this.today, this.day, tz) / 7) * 7, tz),
			day: this.day,
			today: this.today,
			nextSlot: this.nextSlot,
			settings: this.settings,
			marks: this.posts.flatMap((post) =>
				post.status.kind === 'draft'
					? []
					: [
							{
								id: post.id,
								at: post.status.at,
								kind: post.status.kind,
								pinned: false,
								topic: post.meta.topic ?? null,
								text: post.parts[0].text
							}
						]
			)
		};
	});
	badges = $derived({
		drafts: this.posts.filter((post) => post.status.kind === 'draft').length,
		replies: this.state.replies.filter((reply) => reply.draft !== null).length
	});

	go(href: string) {
		this.url = new URL(href, this.url);
	}

	/** Runs one store operation; its return value is the toast. Errors become a toast too. */
	act(operation: (store: DemoStore) => string | void) {
		try {
			const text = operation(this.#store);
			if (text) this.say(text);
			return true;
		} catch (error) {
			this.say(
				error instanceof ZodError
					? (error.issues[0]?.message ?? 'Check the post')
					: error instanceof Error
						? error.message
						: 'That didn’t work. Try again.',
				true
			);
			return false;
		} finally {
			// A compound step can commit its first half before the second throws.
			this.state = this.#store.state;
		}
	}

	arrived(id: string) {
		this.fresh = { id, n: (this.fresh?.n ?? 0) + 1 };
	}

	say(text: string, error = false) {
		this.toast = { id: (this.toast?.id ?? 0) + 1, text, error };
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => (this.toast = null), 4000);
	}

	reset() {
		this.act((store) => {
			store.reset();
			return 'Sample restored';
		});
		this.go('/app');
	}
}

type Page = 'drafts' | 'schedule' | 'library' | 'compose' | 'settings';

/** The app path for a page on a channel, the way the app's own links write it. */
export function href(channel: Channel, name: Page, params: Record<string, string> = {}) {
	const path =
		channel === 'threads'
			? name === 'drafts'
				? '/app'
				: `/app/${name}`
			: name === 'compose' || name === 'settings'
				? `/app/linkedin/${name}`
				: '/app/linkedin';
	const search = new URLSearchParams(
		channel === 'linkedin' && (name === 'schedule' || name === 'library')
			? { view: name === 'schedule' ? 'scheduled' : 'published', ...params }
			: params
	).toString();
	return search ? `${path}?${search}` : path;
}
