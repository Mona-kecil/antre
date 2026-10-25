import { describe, expect, it } from 'vitest';
import { DemoStore, DEMO_STORAGE_KEY, type DemoState } from './store';
import { daySlots, localInput, parseLocal } from './time';

const now = Date.parse('2026-10-24T01:00:00Z');
function setup() {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		}
	};
	let sequence = 0;
	return {
		values,
		storage,
		store: new DemoStore({
			now: () => now,
			storage,
			id: () => `local-${++sequence}`
		})
	};
}
const post = (store: DemoStore, id: string) => {
	const result = store.state.posts.find((post) => post.id === id);
	if (!result) throw new Error('Missing test post');
	return result;
};

describe('browser-local demo', () => {
	it('creates, edits, queues, moves, swaps, and unqueues posts', () => {
		const { store } = setup();
		const id = store.save({
			channel: 'threads',
			parts: [{ text: 'First thought' }, { text: 'A second part' }]
		});
		store.save({ id, channel: 'threads', parts: [{ text: 'Edited thought' }] });
		expect(post(store, id).parts).toEqual([{ text: 'Edited thought' }]);
		const next = store.next('threads');
		store.queue(id);
		expect(post(store, id).status).toEqual({ kind: 'queued', at: next });
		const moved = now + 10 * 3600000;
		store.schedule(id, moved);
		const other = post(store, 'sample-queued');
		store.swap(id, other.id);
		expect(post(store, id).status).toEqual(other.status);
		expect(post(store, other.id).status).toEqual({ kind: 'queued', at: moved });
		store.unqueue(id);
		expect(post(store, id).status).toEqual({ kind: 'draft' });
	});
	it('keeps channels separate while allowing equal times across channels', () => {
		const { store } = setup();
		const id = store.save({
			channel: 'linkedin',
			parts: [{ text: 'My own LinkedIn draft' }]
		});
		const queued = post(store, 'sample-queued');
		if (queued.status.kind !== 'queued')
			throw new Error('Expected queue fixture');
		expect(() =>
			store.schedule(id, queued.status.kind === 'queued' ? queued.status.at : 0)
		).toThrow('taken');
		const at = now + 12 * 3600000;
		store.schedule(id, at);
		store.schedule('sample-queued', at);
		expect(() => store.swap(id, 'sample-queued')).toThrow('same channel');
		expect(() =>
			store.save({ id, channel: 'threads', parts: [{ text: 'Move channels' }] })
		).toThrow('original channel');
	});
	it('rejects occupied and past times without changing state', () => {
		const { store } = setup();
		const before = store.state;
		const occupied = post(store, 'sample-queued');
		if (occupied.status.kind !== 'queued')
			throw new Error('Expected queue fixture');
		expect(() =>
			store.schedule(
				'sample-thread',
				occupied.status.kind === 'queued' ? occupied.status.at : 0
			)
		).toThrow('taken');
		for (const at of [now, now - 1, NaN, Infinity, now + 0.5])
			expect(() => store.schedule('sample-thread', at)).toThrow('future');
		expect(store.state).toEqual(before);
	});
	it('stores simulated outcomes and retries failed and held posts into free slots', () => {
		const { store } = setup();
		store.simulate('sample-queued', 'published');
		expect(post(store, 'sample-queued').status).toMatchObject({
			kind: 'published',
			outcome: 'simulated'
		});
		expect(() => store.queue('sample-queued')).toThrow('cannot be queued');
		expect(() =>
			store.save({
				id: 'sample-queued',
				channel: 'threads',
				parts: [{ text: 'Edit' }]
			})
		).toThrow('cannot be edited');
		store.retry('sample-failed');
		store.retry('sample-held');
		for (const id of ['sample-failed', 'sample-held'])
			expect(post(store, id).status.kind).toBe('queued');
		store.simulate('sample-failed', 'failed');
		expect(post(store, 'sample-failed').status).toMatchObject({
			kind: 'failed',
			reason: expect.stringContaining('Simulated failure')
		});
		store.retry('sample-failed');
		store.simulate('sample-failed', 'held');
		expect(post(store, 'sample-failed').status.kind).toBe('held');
		expect(() => store.simulate('sample-thread', 'published')).toThrow(
			'Queue the post'
		);
		expect(() => store.retry('sample-note')).toThrow('Only failed or held');
	});
	it('persists edits, settings, and outcomes across reloads, then resets only its own storage key', () => {
		const { store, storage, values } = setup();
		values.set('unrelated', 'keep');
		const id = store.save({
			channel: 'linkedin',
			parts: [{ text: 'Persistent text' }]
		});
		store.updateSettings('linkedin', {
			windows: [{ start: '13:15', end: '18:15' }],
			intervalMinutes: 60,
			timeZone: 'America/New_York'
		});
		store.queue(id);
		store.simulate(id, 'published');
		const reloaded = new DemoStore({ storage, now: () => now });
		expect(reloaded.state).toEqual(store.state);
		reloaded.reset();
		expect(reloaded.state.posts.some((post) => post.id === id)).toBe(false);
		expect(reloaded.state.settings.linkedin.timeZone).toBe('Asia/Jakarta');
		expect(new DemoStore({ storage, now: () => now }).state).toEqual(
			reloaded.state
		);
		expect(values.get('unrelated')).toBe('keep');
	});
	it('keeps queued UTC instants when settings change', () => {
		const { store } = setup();
		const before = post(store, 'sample-queued').status;
		store.updateSettings('threads', {
			windows: [{ start: '22:00', end: '23:00' }],
			intervalMinutes: 15,
			timeZone: 'Pacific/Auckland'
		});
		expect(post(store, 'sample-queued').status).toEqual(before);
		expect(store.state.settings.linkedin.timeZone).toBe('Asia/Jakarta');
	});
	it('validates text by codepoint, nonempty parts, channel limits, and schedule settings', () => {
		const { store } = setup();
		expect(() =>
			store.save({ channel: 'threads', parts: [{ text: '😀'.repeat(500) }] })
		).not.toThrow();
		expect(() =>
			store.save({ channel: 'linkedin', parts: [{ text: '😀'.repeat(3000) }] })
		).not.toThrow();
		for (const input of [
			{ channel: 'threads', parts: [] },
			{ channel: 'threads', parts: [{ text: ' ' }] },
			{ channel: 'threads', parts: [{ text: '😀'.repeat(501) }] },
			{ channel: 'linkedin', parts: [{ text: 'a'.repeat(3001) }] },
			{ channel: 'linkedin', parts: [{ text: 'one' }, { text: 'two' }] }
		] satisfies Parameters<DemoStore['save']>[0][])
			expect(() => store.save(input)).toThrow();
		expect(() =>
			store.updateSettings('threads', {
				timeZone: 'bad-zone',
				intervalMinutes: 30,
				windows: [{ start: '09:00', end: '10:00' }]
			})
		).toThrow();
	});
	it('recovers from corrupt or incompatible storage and survives blocked writes', () => {
		const { storage, values } = setup();
		for (const saved of [
			'{broken',
			JSON.stringify({ version: 99 }),
			JSON.stringify({ version: 1, posts: [], settings: {} })
		]) {
			values.set(DEMO_STORAGE_KEY, saved);
			const recovered = new DemoStore({ storage, now: () => now });
			expect(recovered.state.posts.length).toBeGreaterThan(0);
			expect(recovered.persistenceNotice).toContain('restored');
		}
		const blocked = new DemoStore({
			now: () => now,
			storage: {
				getItem: () => {
					throw new Error('blocked');
				},
				setItem: () => {
					throw new Error('quota');
				}
			}
		});
		expect(() => blocked.queue('sample-thread')).not.toThrow();
		expect(post(blocked, 'sample-thread').status.kind).toBe('queued');
		expect(blocked.persistenceNotice).toContain('unavailable or full');
	});
	it('notifies subscribers, isolates returned snapshots, and rejects missing IDs', () => {
		const { store } = setup();
		const snapshots: DemoState[] = [];
		const unsubscribe = store.subscribe((state) => snapshots.push(state));
		const snapshot = store.state;
		snapshot.posts.length = 0;
		expect(store.state.posts.length).toBeGreaterThan(0);
		store.queue('sample-thread');
		expect(snapshots).toHaveLength(2);
		unsubscribe();
		store.reset();
		expect(snapshots).toHaveLength(2);
		expect(() => store.queue('missing')).toThrow('no longer exists');
	});
	it('rejects persisted duplicate IDs, occupied slots, and invalid text', () => {
		const { store, storage, values } = setup();
		const state = store.state;
		state.posts.push(structuredClone(state.posts[0]));
		values.set(DEMO_STORAGE_KEY, JSON.stringify(state));
		expect(
			new DemoStore({ storage, now: () => now }).persistenceNotice
		).toContain('restored');
		const duplicateSlots = store.state;
		const first = duplicateSlots.posts.find(
			(post) => post.id === 'sample-queued'
		);
		const second = duplicateSlots.posts.find(
			(post) => post.id === 'sample-queued-two'
		);
		if (!first || !second) throw new Error('Expected queued fixtures');
		second.status = structuredClone(first.status);
		values.set(DEMO_STORAGE_KEY, JSON.stringify(duplicateSlots));
		expect(
			new DemoStore({ storage, now: () => now }).persistenceNotice
		).toContain('restored');
		const badText = store.state;
		badText.posts[0].parts = [{ text: '' }];
		values.set(DEMO_STORAGE_KEY, JSON.stringify(badText));
		expect(
			new DemoStore({ storage, now: () => now }).persistenceNotice
		).toContain('restored');
	});
});

describe('demo wall-clock inputs', () => {
	it('roundtrips an instant in a selected timezone', () => {
		expect(parseLocal(localInput(now, 'Asia/Jakarta'), 'Asia/Jakarta')).toBe(
			now
		);
	});
	it('rejects a missing time and resolves a repeated time to its earlier instant', () => {
		expect(() => parseLocal('2026-03-08T02:30', 'America/New_York')).toThrow(
			'does not exist'
		);
		expect(parseLocal('2026-11-01T01:30', 'America/New_York')).toBe(
			Date.parse('2026-11-01T05:30:00Z')
		);
	});
});

describe('demo DayLine slots', () => {
	it('omits nonexistent local times and includes each fold slot once', () => {
		const settings = {
			windows: [{ start: '01:00', end: '03:00' }],
			intervalMinutes: 30,
			timeZone: 'America/New_York'
		};
		expect(
			daySlots('2026-03-08', settings).map((at) => new Date(at).toISOString())
		).toEqual([
			'2026-03-08T06:00:00.000Z',
			'2026-03-08T06:30:00.000Z',
			'2026-03-08T07:00:00.000Z'
		]);
		expect(
			daySlots('2026-11-01', {
				...settings,
				windows: [{ start: '01:00', end: '02:00' }]
			}).map((at) => new Date(at).toISOString())
		).toEqual([
			'2026-11-01T05:00:00.000Z',
			'2026-11-01T05:30:00.000Z',
			'2026-11-01T07:00:00.000Z'
		]);
	});
	it('returns an empty timeline when a whole window falls in a clock gap', () => {
		expect(
			daySlots('2026-03-08', {
				windows: [{ start: '02:00', end: '02:30' }],
				intervalMinutes: 30,
				timeZone: 'America/New_York'
			})
		).toEqual([]);
	});
});
