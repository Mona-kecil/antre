import { z } from 'zod';
import { nextSlot, validateSchedulingSettings } from '../domain/scheduling';

export const DEMO_STORAGE_KEY = 'antre.demo.v1';
export const channels = ['threads', 'linkedin'] as const;
export const channelSchema = z.enum(channels);
export type Channel = z.infer<typeof channelSchema>;
const instant = z.number().int().min(-8640000000000000).max(8640000000000000);
const settingsSchema = z
	.object({
		windows: z
			.array(z.object({ start: z.string(), end: z.string() }))
			.min(1)
			.max(12),
		intervalMinutes: z.number(),
		timeZone: z.string()
	})
	.superRefine((settings, ctx) => {
		try {
			validateSchedulingSettings(settings);
		} catch (error) {
			ctx.addIssue({
				code: 'custom',
				message:
					error instanceof Error ? error.message : 'Check posting settings'
			});
		}
	});
export type DemoSettings = z.infer<typeof settingsSchema>;
const statusSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('draft') }),
	z.object({ kind: z.literal('queued'), at: instant }),
	z.object({ kind: z.literal('failed'), at: instant, reason: z.string() }),
	z.object({ kind: z.literal('held'), at: instant, reason: z.string() }),
	z.object({
		kind: z.literal('published'),
		at: instant,
		outcome: z.literal('simulated')
	})
]);
const contentSchema = z
	.object({
		channel: channelSchema,
		parts: z
			.array(
				z.object({
					text: z.string().trim().min(1, 'Write some text in each part')
				})
			)
			.min(1)
			.max(20)
	})
	.superRefine(({ channel, parts }, ctx) => {
		const limit = channel === 'threads' ? 500 : 3000;
		if (channel === 'linkedin' && parts.length !== 1)
			ctx.addIssue({ code: 'custom', message: 'LinkedIn uses one text post' });
		if (parts.some((part) => [...part.text].length > limit))
			ctx.addIssue({
				code: 'custom',
				message: `Keep each ${channel === 'threads' ? 'Threads part' : 'LinkedIn post'} within ${limit} characters`
			});
	});
const postSchema = contentSchema.safeExtend({
	id: z.string().min(1),
	createdAt: instant,
	status: statusSchema
});
export type DemoPost = z.infer<typeof postSchema>;
const stateSchema = z
	.object({
		version: z.literal(1),
		posts: z.array(postSchema).max(1000),
		settings: z.object({ threads: settingsSchema, linkedin: settingsSchema })
	})
	.superRefine(({ posts }, ctx) => {
		if (new Set(posts.map((post) => post.id)).size !== posts.length)
			ctx.addIssue({ code: 'custom', message: 'Duplicate demo post IDs' });
		const slots = posts
			.filter(
				(post) =>
					post.status.kind === 'queued' || post.status.kind === 'published'
			)
			.map(
				(post) => `${post.channel}:${'at' in post.status ? post.status.at : ''}`
			);
		if (new Set(slots).size !== slots.length)
			ctx.addIssue({ code: 'custom', message: 'Duplicate demo queue slots' });
	});
export type DemoState = z.infer<typeof stateSchema>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Listener = (state: DemoState) => void;

export function demoFixtures(now: number): DemoState {
	const settings: DemoSettings = {
		windows: [
			{ start: '09:00', end: '12:00' },
			{ start: '16:00', end: '18:00' }
		],
		intervalMinutes: 30,
		timeZone: 'Asia/Jakarta'
	};
	const at = nextSlot(settings, new Set(), now);
	const following = nextSlot(settings, new Set([at]), now);
	return {
		version: 1,
		settings: {
			threads: structuredClone(settings),
			linkedin: structuredClone(settings)
		},
		posts: [
			{
				id: 'sample-thread',
				channel: 'threads',
				createdAt: now - 3600000,
				parts: [
					{
						text: 'A small rule for making things: leave the next person a clear place to start.'
					},
					{
						text: 'Name the draft. Write down the open question. Put the next step where they can see it.'
					}
				],
				status: { kind: 'draft' }
			},
			{
				id: 'sample-note',
				channel: 'threads',
				createdAt: now - 7200000,
				parts: [
					{
						text: 'Today’s workbench: one notebook, three rough ideas, and enough room to change my mind.'
					}
				],
				status: { kind: 'draft' }
			},
			{
				id: 'sample-queued',
				channel: 'threads',
				createdAt: now - 86400000,
				parts: [
					{
						text: 'The first version gives you something to ask better questions about. Make it small. Put it in someone’s hands.'
					}
				],
				status: { kind: 'queued', at }
			},
			{
				id: 'sample-queued-two',
				channel: 'threads',
				createdAt: now - 86400000,
				parts: [
					{
						text: 'A walk without headphones is part of my writing process. The notes tend to arrive on the way home.'
					}
				],
				status: { kind: 'queued', at: following }
			},
			{
				id: 'sample-failed',
				channel: 'threads',
				createdAt: now - 86400000,
				parts: [
					{ text: 'Some days, the useful work is taking a sentence out.' }
				],
				status: {
					kind: 'failed',
					at: now - 1800000,
					reason:
						'Sample failure: the platform rejected this attempt. Retry to place it back in the demo queue.'
				}
			},
			{
				id: 'sample-held',
				channel: 'threads',
				createdAt: now - 86400000,
				parts: [
					{
						text: 'Keep a little space in the schedule for the thing you haven’t noticed yet.'
					}
				],
				status: {
					kind: 'held',
					at: now - 3600000,
					reason:
						'Sample hold: the connection needs attention. No real account is connected in this demo.'
				}
			},
			{
				id: 'sample-published',
				channel: 'threads',
				createdAt: now - 172800000,
				parts: [
					{
						text: 'Finished a sketchbook today. Most pages are unfinished. They still did their job.'
					}
				],
				status: { kind: 'published', at: now - 86400000, outcome: 'simulated' }
			},
			{
				id: 'sample-linkedin-draft',
				channel: 'linkedin',
				createdAt: now - 3600000,
				parts: [
					{
						text: 'We changed our project handoffs this week.\n\nEach handoff now includes three things: what works, what remains open, and the next step. It takes a few minutes to write and gives the next person a place to start.\n\nWhat do you include in a handoff?'
					}
				],
				status: { kind: 'draft' }
			},
			{
				id: 'sample-linkedin-queue',
				channel: 'linkedin',
				createdAt: now - 7200000,
				parts: [
					{
						text: 'A good review starts with a shared question. Before our next review, we’re writing down the decision we need to make. The slides can wait.'
					}
				],
				status: { kind: 'queued', at }
			},
			{
				id: 'sample-linkedin-published',
				channel: 'linkedin',
				createdAt: now - 172800000,
				parts: [
					{
						text: 'We set aside one afternoon to document the questions new teammates ask. Those questions became our onboarding guide.'
					}
				],
				status: { kind: 'published', at: now - 86400000, outcome: 'simulated' }
			}
		]
	};
}

/** No timers or publishers: every transition requires a local user action. */
export class DemoStore {
	#state: DemoState;
	#listeners = new Set<Listener>();
	#storage?: Storage;
	#now: () => number;
	#id: () => string;
	persistenceNotice = '';

	constructor({
		storage,
		now = Date.now,
		id = () => crypto.randomUUID()
	}: { storage?: Storage; now?: () => number; id?: () => string } = {}) {
		this.#storage = storage;
		this.#now = now;
		this.#id = id;
		this.#state = demoFixtures(now());
		try {
			const saved = storage?.getItem(DEMO_STORAGE_KEY);
			if (saved) {
				const parsed = stateSchema.safeParse(JSON.parse(saved));
				if (!parsed.success) throw new Error('Invalid demo data');
				this.#state = parsed.data;
			}
		} catch {
			this.persistenceNotice =
				'Saved demo data could not be read. Sample posts have been restored.';
		}
	}
	get state(): DemoState {
		return structuredClone(this.#state);
	}
	subscribe(listener: Listener) {
		this.#listeners.add(listener);
		listener(this.state);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	#commit(state: DemoState) {
		this.#state = stateSchema.parse(state);
		try {
			this.#storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(this.#state));
		} catch {
			this.persistenceNotice =
				'Browser storage is unavailable or full. Changes will last until you leave this page.';
		}
		for (const listener of this.#listeners) listener(this.state);
	}
	#post(id: string) {
		const post = this.#state.posts.find((post) => post.id === id);
		if (!post) throw new Error('This demo post no longer exists');
		return post;
	}
	#replace(id: string, change: (post: DemoPost) => DemoPost) {
		this.#post(id);
		this.#commit({
			...this.#state,
			posts: this.#state.posts.map((post) =>
				post.id === id ? change(post) : post
			)
		});
	}
	occupied(channel: Channel, excluding?: string): Set<number> {
		return new Set(
			this.#state.posts.flatMap((post) =>
				post.channel === channel &&
				post.id !== excluding &&
				(post.status.kind === 'queued' || post.status.kind === 'published')
					? [post.status.at]
					: []
			)
		);
	}
	next(channel: Channel, excluding?: string) {
		return nextSlot(
			this.#state.settings[channel],
			this.occupied(channel, excluding),
			this.#now()
		);
	}
	save(input: {
		id?: string;
		channel: Channel;
		parts: { text: string }[];
	}): string {
		const content = contentSchema.parse(input);
		if (input.id) {
			const current = this.#post(input.id);
			if (current.channel !== input.channel)
				throw new Error('A draft stays in its original channel');
			if (current.status.kind === 'published')
				throw new Error('Simulated published posts cannot be edited');
			this.#replace(input.id, (post) => ({ ...post, ...content }));
			return input.id;
		}
		const id = this.#id();
		this.#commit({
			...this.#state,
			posts: [
				{ ...content, id, createdAt: this.#now(), status: { kind: 'draft' } },
				...this.#state.posts
			]
		});
		return id;
	}
	queue(id: string) {
		const post = this.#post(id);
		this.schedule(id, this.next(post.channel, id));
	}
	schedule(id: string, at: number) {
		const post = this.#post(id);
		if (post.status.kind === 'published')
			throw new Error('Simulated published posts cannot be queued');
		if (
			!Number.isInteger(at) ||
			at <= this.#now() ||
			!instant.safeParse(at).success
		)
			throw new Error('Choose a future date and time');
		if (this.occupied(post.channel, id).has(at))
			throw new Error(
				'That time is taken. Choose another time or swap queued posts.'
			);
		this.#replace(id, (post) => ({ ...post, status: { kind: 'queued', at } }));
	}
	unqueue(id: string) {
		if (this.#post(id).status.kind === 'published')
			throw new Error('Simulated published posts stay in the library');
		this.#replace(id, (post) => ({ ...post, status: { kind: 'draft' } }));
	}
	swap(id: string, otherId: string) {
		const first = this.#post(id),
			second = this.#post(otherId);
		if (
			id === otherId ||
			first.channel !== second.channel ||
			first.status.kind !== 'queued' ||
			second.status.kind !== 'queued'
		)
			throw new Error('Choose two queued posts in the same channel');
		const firstStatus = first.status,
			secondStatus = second.status;
		this.#commit({
			...this.#state,
			posts: this.#state.posts.map((post) =>
				post.id === id
					? { ...post, status: secondStatus }
					: post.id === otherId
						? { ...post, status: firstStatus }
						: post
			)
		});
	}
	retry(id: string) {
		const kind = this.#post(id).status.kind;
		if (kind !== 'held' && kind !== 'failed')
			throw new Error('Only failed or held posts can be retried');
		this.queue(id);
	}
	simulate(id: string, outcome: 'published' | 'failed' | 'held') {
		const post = this.#post(id);
		if (post.status.kind !== 'queued')
			throw new Error('Queue the post before simulating an outcome');
		const at = post.status.at;
		this.#replace(id, (post) => ({
			...post,
			status:
				outcome === 'published'
					? { kind: 'published', at, outcome: 'simulated' }
					: {
							kind: outcome,
							at,
							reason:
								outcome === 'failed'
									? 'Simulated failure: the platform rejected this attempt. Retry to queue it again.'
									: 'Simulated hold: this connection needs attention. Retry to queue it again.'
						}
		}));
	}
	updateSettings(channel: Channel, input: DemoSettings) {
		const settings = validateSchedulingSettings(settingsSchema.parse(input));
		this.#commit({
			...this.#state,
			settings: { ...this.#state.settings, [channel]: settings }
		});
	}
	reset() {
		this.#commit(demoFixtures(this.#now()));
	}
}
