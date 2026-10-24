import { Temporal } from '@js-temporal/polyfill';

export type SchedulingSettings = {
	windows: { start: string; end: string }[];
	intervalMinutes: number;
	timeZone: string;
};

const minuteOfDay = (time: string) => {
	const [hour, minute] = time.split(':').map(Number);
	return hour * 60 + minute;
};

export function validateSchedulingSettings<T extends SchedulingSettings>(
	settings: T
): T {
	if (
		!Number.isInteger(settings.intervalMinutes) ||
		settings.intervalMinutes < 5 ||
		settings.intervalMinutes > 240
	)
		throw new Error('Use an interval between 5 and 240 whole minutes');
	if (/^[+-]/.test(settings.timeZone))
		throw new Error('Use an IANA time zone such as Asia/Jakarta');
	Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(
		settings.timeZone
	);
	if (!settings.windows.length)
		throw new Error('Add at least one posting window');
	const windows = [...settings.windows].sort((a, b) =>
		a.start.localeCompare(b.start)
	);
	for (const [index, window] of windows.entries()) {
		if (
			![window.start, window.end].every((time) =>
				/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
			)
		)
			throw new Error('Use HH:MM for window times');
		if (window.start > window.end)
			throw new Error('Window start must not follow its end');
		if (index > 0 && windows[index - 1].end >= window.start)
			throw new Error('Posting windows must not overlap, including endpoints');
	}
	return { ...settings, windows };
}

function* localSlots(settings: SchedulingSettings, day: Temporal.PlainDate) {
	for (const window of settings.windows) {
		for (
			let minute = minuteOfDay(window.start);
			minute <= minuteOfDay(window.end);
			minute += settings.intervalMinutes
		) {
			const local = day.toPlainDateTime({
				hour: Math.floor(minute / 60),
				minute: minute % 60
			});
			const zoned = local.toZonedDateTime(settings.timeZone, {
				disambiguation: 'earlier'
			});
			// A gap shifts the wall clock; it has no slot. A fold keeps the earlier instant.
			if (local.equals(zoned.toPlainDateTime())) yield zoned.epochMilliseconds;
		}
	}
}

export function slotsForDay(
	settings: SchedulingSettings,
	day: string
): number[] {
	return [
		...localSlots(
			validateSchedulingSettings(settings),
			Temporal.PlainDate.from(day)
		)
	];
}

/** Inclusive endpoints; each window starts its own interval grid. */
export function nextSlot(
	settings: SchedulingSettings,
	occupied: Set<number>,
	after: number
): number {
	const checked = validateSchedulingSettings(settings);
	let day = Temporal.Instant.fromEpochMilliseconds(after)
		.toZonedDateTimeISO(checked.timeZone)
		.toPlainDate();
	for (;;) {
		for (const at of localSlots(checked, day)) {
			if (at > after && !occupied.has(at)) return at;
		}
		day = day.add({ days: 1 });
	}
}
