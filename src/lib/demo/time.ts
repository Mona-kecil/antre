import { Temporal } from '@js-temporal/polyfill';
import { slotsForDay, type SchedulingSettings } from '../domain/scheduling';

export function dateKey(at: number, timeZone: string): string {
	return Temporal.Instant.fromEpochMilliseconds(at)
		.toZonedDateTimeISO(timeZone)
		.toPlainDate()
		.toString();
}
export function localInput(at: number, timeZone: string): string {
	return Temporal.Instant.fromEpochMilliseconds(at)
		.toZonedDateTimeISO(timeZone)
		.toPlainDateTime()
		.toString({ smallestUnit: 'minute' });
}
export function parseLocal(input: string, timeZone: string): number {
	const local = Temporal.PlainDateTime.from(input);
	const zoned = local.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
	if (!local.equals(zoned.toPlainDateTime()))
		throw new Error(
			'That local time does not exist because the clocks change. Choose another time.'
		);
	return zoned.epochMilliseconds;
}
export function clock(at: number, timeZone: string): string {
	return new Intl.DateTimeFormat('en', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(at);
}
export function when(at: number, timeZone: string): string {
	return new Intl.DateTimeFormat('en', {
		timeZone,
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(at);
}
export function daySlots(day: string, settings: SchedulingSettings): number[] {
	return slotsForDay(settings, day);
}
