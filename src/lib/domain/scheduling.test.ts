import { describe, expect, it } from 'vitest';
import {
	nextSlot,
	validateSchedulingSettings,
	type SchedulingSettings
} from './scheduling';

const instant = (value: string) => Date.parse(value);
const settings: SchedulingSettings = {
	windows: [
		{ start: '09:00', end: '10:00' },
		{ start: '16:00', end: '17:00' }
	],
	intervalMinutes: 30,
	timeZone: 'Asia/Jakarta'
};

describe('nextSlot', () => {
	it('uses inclusive endpoints, strictly after the instant, and skips occupied UTC times', () => {
		expect(nextSlot(settings, new Set(), instant('2026-10-24T01:59:00Z'))).toBe(
			instant('2026-10-24T02:00:00Z')
		);
		expect(
			nextSlot(
				settings,
				new Set([instant('2026-10-24T02:30:00Z')]),
				instant('2026-10-24T02:00:00Z')
			)
		).toBe(instant('2026-10-24T03:00:00Z'));
	});
	it('rolls across windows, month boundaries, and leap days', () => {
		expect(nextSlot(settings, new Set(), instant('2026-10-24T03:00:00Z'))).toBe(
			instant('2026-10-24T09:00:00Z')
		);
		expect(nextSlot(settings, new Set(), instant('2028-02-28T10:00:00Z'))).toBe(
			instant('2028-02-29T02:00:00Z')
		);
		expect(nextSlot(settings, new Set(), instant('2028-02-29T10:00:00Z'))).toBe(
			instant('2028-03-01T02:00:00Z')
		);
	});
	it('starts each window on its own interval grid and orders unsorted windows', () => {
		const custom = {
			...settings,
			windows: [
				{ start: '16:10', end: '17:00' },
				{ start: '09:05', end: '10:00' }
			],
			intervalMinutes: 40
		};
		expect(nextSlot(custom, new Set(), instant('2026-10-24T00:00:00Z'))).toBe(
			instant('2026-10-24T02:05:00Z')
		);
		expect(nextSlot(custom, new Set(), instant('2026-10-24T02:45:00Z'))).toBe(
			instant('2026-10-24T09:10:00Z')
		);
	});
	it('skips nonexistent spring slots without shifting them', () => {
		const spring = {
			windows: [{ start: '01:30', end: '03:30' }],
			intervalMinutes: 30,
			timeZone: 'America/New_York'
		};
		expect(nextSlot(spring, new Set(), instant('2026-03-08T06:30:00Z'))).toBe(
			instant('2026-03-08T07:00:00Z')
		);
		const gapOnly = { ...spring, windows: [{ start: '02:00', end: '02:30' }] };
		expect(nextSlot(gapOnly, new Set(), instant('2026-03-08T00:00:00Z'))).toBe(
			instant('2026-03-09T06:00:00Z')
		);
	});
	it('chooses only the earlier fall occurrence, even if that occurrence is occupied or past', () => {
		const fall = {
			windows: [{ start: '01:00', end: '02:00' }],
			intervalMinutes: 30,
			timeZone: 'America/New_York'
		};
		expect(nextSlot(fall, new Set(), instant('2026-11-01T04:59:00Z'))).toBe(
			instant('2026-11-01T05:00:00Z')
		);
		expect(
			nextSlot(
				fall,
				new Set([instant('2026-11-01T05:30:00Z')]),
				instant('2026-11-01T05:00:00Z')
			)
		).toBe(instant('2026-11-01T07:00:00Z'));
		expect(nextSlot(fall, new Set(), instant('2026-11-01T06:00:00Z'))).toBe(
			instant('2026-11-01T07:00:00Z')
		);
	});
	it('handles a half-hour DST gap', () => {
		const halfHour = {
			windows: [{ start: '02:00', end: '03:00' }],
			intervalMinutes: 15,
			timeZone: 'Australia/Lord_Howe'
		};
		expect(nextSlot(halfHour, new Set(), instant('2026-10-03T15:00:00Z'))).toBe(
			instant('2026-10-03T15:30:00Z')
		);
	});
	it('does not mutate settings or occupied instants', () => {
		const occupied = new Set([instant('2026-10-24T02:00:00Z')]);
		const before = structuredClone(settings);
		nextSlot(settings, occupied, instant('2026-10-24T00:00:00Z'));
		expect(settings).toEqual(before);
		expect([...occupied]).toEqual([instant('2026-10-24T02:00:00Z')]);
	});
	it('rejects invalid settings instead of looping', () => {
		for (const value of [
			{ ...settings, windows: [] },
			{ ...settings, intervalMinutes: 0 },
			{ ...settings, intervalMinutes: 1.5 },
			{ ...settings, timeZone: 'not/a-zone' },
			{ ...settings, windows: [{ start: '25:00', end: '26:00' }] },
			{ ...settings, windows: [{ start: '10:00', end: '09:00' }] },
			{
				...settings,
				windows: [
					{ start: '09:00', end: '10:00' },
					{ start: '10:00', end: '11:00' }
				]
			}
		])
			expect(() => nextSlot(value, new Set(), Date.now())).toThrow();
		expect(() => nextSlot(settings, new Set(), NaN)).toThrow();
		expect(() =>
			validateSchedulingSettings({ ...settings, timeZone: 'UTC' })
		).not.toThrow();
	});
});
