import { describe, expect, it } from 'vitest';
import { sampleStart } from './fixtures';
import { DemoStore } from './store';

const now = sampleStart(Date.parse('2026-10-24T01:00:00Z'));
const at = (iso: string) => Date.parse(iso);
function setup() {
	let sequence = 0;
	return new DemoStore({ now: () => now, id: () => `local-${++sequence}` });
}
const post = (store: DemoStore, id: string) => {
	const result = store.state.posts.find((post) => post.id === id);
	if (!result) throw new Error('Missing test post');
	return result;
};
const meta = { topic: 'T01' };

describe('sample workspace store', () => {
	it('starts at 10:12 in Jakarta with drafts, a failed post, and a week that is half published', () => {
		const store = setup();
		expect(new Date(now).toISOString()).toBe('2026-10-24T03:12:00.000Z');
		expect(post(store, 'release').status).toEqual({ kind: 'draft' });
		expect(post(store, 'sentence').status.kind).toBe('failed');
		expect(post(store, 'sample-5').status).toEqual({ kind: 'published', at: at('2026-10-24T02:30:00Z') });
		expect(post(store, 'sample-6').status).toEqual({ kind: 'queued', at: at('2026-10-24T03:30:00Z') });
		expect(post(store, 'sample-5').metrics?.views).toBeGreaterThan(0);
	});

	it('queues a draft into the next free slot of its own channel', () => {
		const store = setup();
		expect(store.queue('release')).toBe(at('2026-10-24T04:30:00Z'));
		expect(store.queue('first-line')).toBe(at('2026-10-24T05:00:00Z'));
		expect(store.queue('handoff')).toBe(at('2026-10-24T03:30:00Z'));
	});

	it('saves new posts as your drafts and edits keep the id', () => {
		const store = setup();
		const id = store.save({ channel: 'threads', parts: [{ text: 'First' }, { text: 'Second' }], meta });
		expect(post(store, id)).toMatchObject({ source: 'you', createdAt: now, status: { kind: 'draft' }, meta });
		expect(store.save({ id, channel: 'threads', parts: [{ text: 'Edited' }], meta: {} })).toBe(id);
		expect(post(store, id).parts).toEqual([{ text: 'Edited' }]);
		expect(() => store.save({ id, channel: 'linkedin', parts: [{ text: 'Moved' }], meta: {} })).toThrow(
			'original channel'
		);
		expect(() => store.save({ channel: 'threads', parts: [{ text: '  ' }], meta: {} })).toThrow();
		expect(() =>
			store.save({ id: 'sample-0', channel: 'threads', parts: [{ text: 'Rewrite' }], meta: {} })
		).toThrow('Published posts cannot be edited');
	});

	it('schedules only free future times and moves posts back to drafts', () => {
		const store = setup();
		expect(() => store.schedule('release', now)).toThrow('future');
		expect(() => store.schedule('release', at('2026-10-24T03:30:00Z'))).toThrow('taken');
		store.schedule('release', at('2026-10-25T05:15:00Z'));
		expect(post(store, 'release').status).toEqual({ kind: 'queued', at: at('2026-10-25T05:15:00Z') });
		store.unqueue('release');
		expect(post(store, 'release').status).toEqual({ kind: 'draft' });
		expect(() => store.unqueue('sample-0')).toThrow('library');
	});

	it('swaps two queued posts in one channel', () => {
		const store = setup();
		const [first, second] = [post(store, 'sample-6').status, post(store, 'sample-7').status];
		store.swap('sample-6', 'sample-7');
		expect(post(store, 'sample-6').status).toEqual(second);
		expect(post(store, 'sample-7').status).toEqual(first);
		expect(() => store.swap('sample-6', 'review')).toThrow('same channel');
		expect(() => store.swap('sample-6', 'release')).toThrow();
	});

	it('retries failed posts, publishes now, and removes posts', () => {
		const store = setup();
		expect(() => store.retry('release')).toThrow('Only failed posts');
		expect(post(store, 'sentence').status).toMatchObject({ kind: 'failed' });
		expect(store.retry('sentence')).toBe(at('2026-10-24T04:30:00Z'));
		store.publish('notebook');
		expect(post(store, 'notebook').status).toEqual({ kind: 'published', at: now });
		expect(() => store.publish('notebook')).toThrow('already published');
		store.remove('notebook');
		expect(store.state.posts.some((post) => post.id === 'notebook')).toBe(false);
		expect(() => store.remove('notebook')).toThrow('no longer exists');
	});

	it('queues by the saved posting windows and rejects windows that cannot post', () => {
		const store = setup();
		store.updateSettings('threads', {
			windows: [{ start: '16:00', end: '16:00' }],
			intervalMinutes: 30,
			timeZone: 'Asia/Jakarta'
		});
		expect(store.queue('release')).toBe(at('2026-10-24T09:00:00Z'));
		expect(() =>
			store.updateSettings('threads', { windows: [], intervalMinutes: 30, timeZone: 'Asia/Jakarta' })
		).toThrow();
		expect(() =>
			store.updateSettings('threads', {
				windows: [{ start: '12:00', end: '09:00' }],
				intervalMinutes: 30,
				timeZone: 'Asia/Jakarta'
			})
		).toThrow();
	});

	it('saves, sends, and discards reply drafts without touching other replies', () => {
		const store = setup();
		expect(() => store.sendReply('reply-tools')).toThrow('Save an answer');
		expect(() => store.saveReply('reply-tools', ' ')).toThrow('Write an answer');
		expect(() => store.saveReply('reply-tools', 'x'.repeat(501))).toThrow('500');
		store.saveReply('reply-tools', '  The second one.  ');
		store.sendReply('reply-tools');
		store.discardReply('reply-kept');
		const replies = Object.fromEntries(store.state.replies.map((reply) => [reply.id, reply]));
		expect(replies['reply-tools']).toMatchObject({ draft: null, sent: 'The second one.' });
		expect(replies['reply-kept']).toMatchObject({ draft: null, sent: null });
		expect(replies['reply-sunday'].draft).toContain('Sunday evening');
	});

	it('resets to the starting sample', () => {
		const store = setup();
		const start = store.state;
		store.queue('release');
		store.remove('handoff');
		store.saveReply('reply-tools', 'Later.');
		store.reset();
		expect(store.state).toEqual(start);
	});

	it('hands out copies so callers cannot change the store', () => {
		const store = setup();
		store.state.posts[0].parts[0].text = 'Changed';
		expect(store.state.posts[0].parts[0].text).not.toBe('Changed');
	});
});
