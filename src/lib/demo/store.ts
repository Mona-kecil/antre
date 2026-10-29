import { z } from 'zod';
import { nextSlot, validateSchedulingSettings } from '../domain/scheduling';
import { sampleState } from './fixtures';

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
	z.object({ kind: z.literal('published'), at: instant })
]);
const metaSchema = z.object({
	topic: z.string().optional(),
	angle: z.string().optional(),
	format: z.string().optional(),
	notes: z.string().optional()
});
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
			.max(20),
		meta: metaSchema
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
	source: z.enum(['agent', 'you']),
	createdAt: instant,
	status: statusSchema,
	metrics: z.object({ views: z.number(), likes: z.number(), replies: z.number() }).optional()
});
export type DemoPost = z.infer<typeof postSchema>;
const answer = z
	.string()
	.trim()
	.min(1, 'Write an answer first')
	.refine((text) => [...text].length <= 500, 'Keep the answer within 500 characters');
const replySchema = z.object({
	id: z.string().min(1),
	username: z.string(),
	text: z.string(),
	postText: z.string(),
	at: instant,
	draft: answer.nullable(),
	sent: z.string().nullable()
});
export type DemoReply = z.infer<typeof replySchema>;
const stateSchema = z
	.object({
		posts: z.array(postSchema).max(1000),
		replies: z.array(replySchema),
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

/** No timers, publishers, or storage: every transition is a local user action, and a reload starts over. */
export class DemoStore {
	#state: DemoState;
	#now: () => number;
	#id: () => string;
	#start: number;

	constructor({
		now = Date.now,
		id = () => crypto.randomUUID()
	}: { now?: () => number; id?: () => string } = {}) {
		this.#now = now;
		this.#id = id;
		this.#start = now();
		this.#state = stateSchema.parse(sampleState(this.#start));
	}
	get state(): DemoState {
		return structuredClone(this.#state);
	}
	#commit(state: DemoState) {
		this.#state = stateSchema.parse(state);
	}
	#post(id: string) {
		const post = this.#state.posts.find((post) => post.id === id);
		if (!post) throw new Error('This sample post no longer exists');
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
	#reply(id: string, change: (reply: DemoReply) => DemoReply) {
		if (!this.#state.replies.some((reply) => reply.id === id))
			throw new Error('This sample reply no longer exists');
		this.#commit({
			...this.#state,
			replies: this.#state.replies.map((reply) =>
				reply.id === id ? change(reply) : reply
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
		meta: DemoPost['meta'];
	}): string {
		const content = contentSchema.parse(input);
		if (input.id) {
			const current = this.#post(input.id);
			if (current.channel !== input.channel)
				throw new Error('A draft stays in its original channel');
			if (current.status.kind === 'published')
				throw new Error('Published posts cannot be edited');
			this.#replace(input.id, (post) => ({ ...post, ...content }));
			return input.id;
		}
		const id = this.#id();
		this.#commit({
			...this.#state,
			posts: [
				{
					...content,
					id,
					source: 'you',
					createdAt: this.#now(),
					status: { kind: 'draft' }
				},
				...this.#state.posts
			]
		});
		return id;
	}
	/** Returns the slot the post took. */
	queue(id: string) {
		const post = this.#post(id);
		const at = this.next(post.channel, id);
		if (!at) throw new Error('No free slot left. Add a posting window in Settings.');
		this.schedule(id, at);
		return at;
	}
	schedule(id: string, at: number) {
		const post = this.#post(id);
		if (post.status.kind === 'published')
			throw new Error('Published posts cannot be queued');
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
			throw new Error('Published posts stay in the library');
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
		if (this.#post(id).status.kind !== 'failed')
			throw new Error('Only failed posts can be retried');
		return this.queue(id);
	}
	/** Marks the post published now. Nothing leaves the browser. */
	publish(id: string) {
		if (this.#post(id).status.kind === 'published')
			throw new Error('This post is already published');
		const at = this.#now();
		this.#replace(id, (post) => ({ ...post, status: { kind: 'published', at } }));
	}
	remove(id: string) {
		this.#post(id);
		this.#commit({
			...this.#state,
			posts: this.#state.posts.filter((post) => post.id !== id)
		});
	}
	saveReply(id: string, text: string) {
		const draft = answer.parse(text);
		this.#reply(id, (reply) => ({ ...reply, draft }));
	}
	sendReply(id: string) {
		this.#reply(id, (reply) => {
			if (reply.draft === null) throw new Error('Save an answer before sending');
			return { ...reply, sent: reply.draft, draft: null };
		});
	}
	discardReply(id: string) {
		this.#reply(id, (reply) => ({ ...reply, draft: null }));
	}
	updateSettings(channel: Channel, input: DemoSettings) {
		const settings = validateSchedulingSettings(settingsSchema.parse(input));
		this.#commit({
			...this.#state,
			settings: { ...this.#state.settings, [channel]: settings }
		});
	}
	reset() {
		this.#commit(sampleState(this.#start));
	}
}
