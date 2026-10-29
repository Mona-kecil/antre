import { calendarDay } from '#lib/calendar.ts';
import type { TaxonomyEntry } from '#lib/labels.ts';
import { dayStart, minutes } from '#lib/time.ts';
import type { DemoPost, DemoReply, DemoState } from './store';

// The sample workspace on the public home. Its clock starts at 10:12 so the day always reads the same.
export const username = 'mira.sample';
export const names = { threads: username, linkedin: 'Mira Sample' };
export const timeZone = 'Asia/Jakarta';
export const settings = {
	windows: [
		{ start: '09:00', end: '12:00' },
		{ start: '16:00', end: '18:00' }
	],
	intervalMinutes: 30,
	timeZone
};

export const taxonomy: TaxonomyEntry[] = [
	{ dimension: 'topic', code: 'T01', name: 'Product' },
	{ dimension: 'topic', code: 'T02', name: 'Craft' },
	{ dimension: 'topic', code: 'T03', name: 'Habits' },
	{ dimension: 'topic', code: 'T04', name: 'Tools' },
	{ dimension: 'angle', code: 'A01', name: 'Lesson' },
	{ dimension: 'angle', code: 'A02', name: 'How-to' },
	{ dimension: 'angle', code: 'A03', name: 'Story' },
	{ dimension: 'format', code: 'F01', name: 'Thread' },
	{ dimension: 'format', code: 'F02', name: 'Single' }
];

export const sampleStart = (at = Date.now()) => dayStart(at, timeZone) + (10 * 60 + 12) * 60_000;

const scheduled: [day: number, time: string, topic: string, text: string][] = [
	[-3, '09:30', 'T02', 'Every draft is a question. Publishing is how you hear the answer.'],
	[-2, '11:00', 'T01', 'The roadmap changed three times this month. The users did not notice once.'],
	[-1, '09:00', 'T03', 'Write before you read. The inbox can wait an hour.'],
	[-1, '16:30', 'T04', 'One text file, one calendar, one queue. That is the whole stack.'],
	[0, '09:00', 'T01', 'A calendar shows when. A queue shows what is next.'],
	[0, '09:30', 'T03', 'Wrote 400 words, kept 41. That still counts.'],
	[0, '10:30', 'T04', 'My whole posting setup fits on one screen now.'],
	[0, '11:00', 'T02', 'Write the reply you wish someone had sent you.'],
	[0, '16:30', 'T01', 'If the release note needs a paragraph, the release is too big.'],
	[0, '17:30', 'T03', 'Ten minutes of writing every day beats one perfect weekend.'],
	[1, '09:00', 'T02', 'The best edit is usually a deletion.'],
	[1, '10:00', 'T01', 'Ship the boring version first.'],
	[1, '11:30', 'T03', 'Done for today is a decision, not a feeling.'],
	[1, '16:00', 'T04', 'Three tools I stopped using this year.'],
	[2, '09:30', 'T01', 'Users remember the first five minutes.'],
	[2, '11:00', 'T02', 'Say it out loud before you post it.'],
	[2, '17:00', 'T03', 'A streak is a promise to tomorrow.'],
	[3, '10:00', 'T04', 'Let the agent draft. Keep the final say.'],
	[3, '16:30', 'T01', 'Roadmaps are guesses with dates.'],
	[4, '09:00', 'T03', 'Start the week with the smallest task.'],
	[5, '10:30', 'T02', 'Titles are promises. Keep them.']
];

export function sampleState(now: number): DemoState {
	const today = dayStart(now, timeZone);
	const slot = (day: number, time: string) => calendarDay(today, day, timeZone) + minutes(time) * 60_000;
	const ago = (min: number) => now - min * 60_000;
	const draft = (
		id: string,
		min: number,
		meta: DemoPost['meta'],
		texts: string[],
		channel: DemoPost['channel'] = 'threads'
	): DemoPost => ({
		id,
		channel,
		source: 'agent',
		createdAt: ago(min),
		meta,
		parts: texts.map((text) => ({ text })),
		status: { kind: 'draft' }
	});
	const planned = scheduled.map(([day, time, topic, text], i): DemoPost => {
		const at = slot(day, time);
		return {
			id: `sample-${i}`,
			channel: 'threads',
			source: i % 3 ? 'agent' : 'you',
			createdAt: at - 2 * 86_400_000,
			meta: { topic, format: 'F02' },
			parts: [{ text }],
			...(at <= now
				? {
						status: { kind: 'published', at },
						metrics: { views: 800 + ((i * 1373) % 4200), likes: 12 + ((i * 37) % 140), replies: (i * 7) % 23 }
					}
				: { status: { kind: 'queued', at } })
		};
	});
	const replies: DemoReply[] = [
		{
			id: 'reply-sunday',
			username: 'dimas.writes',
			text: 'Do you plan the week on Sunday or as you go?',
			postText: 'A calendar shows when. A queue shows what is next.',
			at: ago(24),
			draft: 'Sunday evening, about twenty minutes. Then the queue fills the gaps as drafts come in.',
			sent: null
		},
		{
			id: 'reply-kept',
			username: 'ana.makes',
			text: '41 good words beat 400 okay ones.',
			postText: 'Wrote 400 words, kept 41. That still counts.',
			at: ago(48),
			draft: 'That’s the trade. The other 359 were how I found them.',
			sent: null
		},
		{
			id: 'reply-tools',
			username: 'rafi.builds',
			text: 'Which one did you drop first?',
			postText: 'One text file, one calendar, one queue. That is the whole stack.',
			at: ago(95),
			draft: null,
			sent: null
		}
	];
	return {
		settings: { threads: structuredClone(settings), linkedin: structuredClone(settings) },
		replies,
		posts: [
			draft('release', 4, { topic: 'T01', angle: 'A01', format: 'F01' }, [
				'Small releases make room for better questions.',
				'Instead of asking “Is the whole thing ready?”, ask “What can someone use today?”',
				'A smaller scope is not a smaller ambition. It puts the work in someone’s hands while there is still time to change it.'
			]),
			draft(
				'first-line',
				6,
				{ topic: 'T02', angle: 'A02', format: 'F02', notes: 'Planned for the morning window, before 12:00.' },
				['Cut the first sentence of your draft. Read it again.\n\nMost of the time the post starts better without it.']
			),
			draft('notebook', 9, { topic: 'T03', angle: 'A03', format: 'F02' }, [
				'I keep a note called “tomorrow” at the end of every writing session. One line: where to start next.\n\nIt has saved more mornings than any app.'
			]),
			{
				id: 'sentence',
				channel: 'threads',
				source: 'agent',
				createdAt: ago(600),
				meta: { topic: 'T02', format: 'F02' },
				parts: [{ text: 'Some days the useful work is taking a sentence out.' }],
				status: { kind: 'failed', at: slot(0, '10:00'), reason: 'Threads rejected this attempt.' }
			},
			...planned,
			draft(
				'handoff',
				12,
				{ topic: 'T01', angle: 'A03' },
				[
					'We changed our project handoffs this week.\n\nEach handoff now names three things: what works, what is still open, and the next step. It takes five minutes and gives the next person a place to start.\n\nWhat goes in yours?'
				],
				'linkedin'
			),
			{
				...draft('review', 300, { topic: 'T01', angle: 'A01' }, [
					'A good review starts with a shared question. Before our next one, we are writing down the decision we need to make. The slides can wait.'
				], 'linkedin'),
				status: { kind: 'queued', at: slot(0, '11:30') }
			},
			{
				...draft('onboarding', 300, { topic: 'T03', angle: 'A03' }, [
					'We spent one afternoon writing down the questions new teammates ask. Those questions became our onboarding guide.'
				], 'linkedin'),
				status: { kind: 'queued', at: slot(2, '09:00') }
			},
			{
				...draft('estimate', 3000, { topic: 'T02', angle: 'A01' }, [
					'An estimate is a conversation, not a promise. The useful part is the list of things that could make it wrong.'
				], 'linkedin'),
				status: { kind: 'published', at: slot(-1, '10:00') },
				metrics: { views: 2140, likes: 64, replies: 9 }
			}
		]
	};
}
