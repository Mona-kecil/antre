<script lang="ts">
	import { onMount } from 'svelte';
	import { ZodError } from 'zod';
	import { Temporal } from '@js-temporal/polyfill';
	import Post from '../components/Post.svelte';
	import Icon from '../components/Icon.svelte';
	import Sheet from '../components/Sheet.svelte';
	import DemoTimeline from './DemoTimeline.svelte';
	import {
		DemoStore,
		channels,
		type Channel,
		type DemoState,
		type DemoPost,
		type DemoSettings
	} from './store';
	import { dateKey, localInput, parseLocal, when } from './time';

	type View = 'drafts' | 'schedule' | 'library';
	let demoState = $state<DemoState | null>(null);
	let store: DemoStore | undefined;
	let channel = $state<Channel>('threads');
	let view = $state<View>('drafts');
	let recoveryOnly = $state(false);
	let search = $state('');
	let offset = $state(0);
	let day = $state('');
	let selected = $state<string | null>(null);
	let notice = $state('');
	let storageNotice = $state('');
	let dialogError = $state('');
	let editorOpen = $state(false);
	let editing = $state<string | undefined>();
	let parts = $state<{ text: string; imageUrl?: string }[]>([{ text: '' }]);
	let imagePreviews = $state<Record<string, (string | undefined)[]>>({});
	const objectUrls = new Set<string>();
	let timeOpen = $state(false);
	let target = $state<string | null>(null);
	let chosenTime = $state('');
	let swapOpen = $state(false);
	let simulationOpen = $state(false);
	let settingsOpen = $state(false);
	let resetOpen = $state(false);
	let settingsForm = $state<DemoSettings>({
		windows: [{ start: '09:00', end: '12:00' }],
		intervalMinutes: 30,
		timeZone: 'Asia/Jakarta'
	});

	const channelName = $derived(channel === 'threads' ? 'Threads' : 'LinkedIn');
	const settings = $derived(demoState?.settings[channel]);
	const posts = $derived(
		demoState?.posts.filter((post) => post.channel === channel) ?? []
	);
	const drafts = $derived(posts.filter((post) => post.status.kind === 'draft'));
	const recovery = $derived(
		posts.filter(
			(post) => post.status.kind === 'held' || post.status.kind === 'failed'
		)
	);
	const queued = $derived(
		posts.filter((post) => post.status.kind === 'queued')
	);
	const published = $derived(
		posts.filter((post) => post.status.kind === 'published')
	);
	const schedulePosts = $derived(
		posts
			.filter(
				(post) =>
					post.status.kind !== 'draft' &&
					settings &&
					dateKey(post.status.at, settings.timeZone) === day
			)
			.sort(
				(a, b) =>
					('at' in a.status ? a.status.at : 0) -
					('at' in b.status ? b.status.at : 0)
			)
	);
	const filtered = $derived(
		(view === 'drafts'
			? recoveryOnly
				? recovery
				: drafts
			: view === 'schedule'
				? schedulePosts
				: published
		).filter((post) =>
			post.parts.some((part) =>
				part.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())
			)
		)
	);
	const pagePosts = $derived(filtered.slice(offset, offset + 20));
	const next = $derived.by(() => {
		if (!demoState || !store) return null;
		return store.next(channel);
	});
	const marks = $derived(
		schedulePosts.flatMap((post) =>
			post.status.kind === 'draft'
				? []
				: [{ id: post.id, at: post.status.at, kind: post.status.kind }]
		)
	);
	const targetPost = $derived(posts.find((post) => post.id === target));
	const swappable = $derived(queued.filter((post) => post.id !== target));
	const limit = $derived(channel === 'threads' ? 500 : 3000);
	const invalidContent = $derived(
		parts.some(
			(part) => !part.text.trim() || [...part.text.trim()].length > limit
		)
	);

	onMount(() => {
		let storage: Storage | undefined;
		try {
			storage = window.localStorage;
		} catch {
			storageNotice =
				'Browser storage is unavailable. Changes will last until you leave this page.';
		}
		store = new DemoStore({ storage });
		storageNotice = store.persistenceNotice || storageNotice;
		const unsubscribe = store.subscribe((value) => {
			demoState = value;
		});
		day = dateKey(store.next(channel), store.state.settings[channel].timeZone);
		return () => {
			unsubscribe();
			for (const url of objectUrls) URL.revokeObjectURL(url);
		};
	});

	function changeView(value: View) {
		view = value;
		offset = 0;
		search = '';
		selected = null;
	}
	function changeChannel(value: Channel) {
		channel = value;
		offset = 0;
		search = '';
		recoveryOnly = false;
		selected = null;
		if (store && settings)
			day = dateKey(store.next(value), store.state.settings[value].timeZone);
	}
	function run(action: (demo: DemoStore) => void, message: string): boolean {
		if (!store) return false;
		try {
			action(store);
			notice = message;
			dialogError = '';
			storageNotice = store.persistenceNotice || storageNotice;
			offset = Math.min(
				offset,
				Math.max(0, Math.floor((filtered.length - 1) / 20) * 20)
			);
			return true;
		} catch (error) {
			const message =
				error instanceof ZodError
					? (error.issues[0]?.message ??
						'Check your text and posting settings.')
					: error instanceof Error
						? error.message
						: 'This change could not be saved. Try again.';
			dialogError = message;
			notice = message;
			return false;
		}
	}
	function compose(post?: DemoPost) {
		editing = post?.id;
		parts = post
			? post.parts.map((part, index) => ({
					text: part.text,
					imageUrl: imagePreviews[post.id]?.[index]
				}))
			: [{ text: '' }];
		dialogError = '';
		editorOpen = true;
	}
	function save() {
		if (
			run(
				(demo) => {
					const id = demo.save({
						id: editing,
						channel,
						parts: parts.map(({ text }) => ({ text }))
					});
					imagePreviews = {
						...imagePreviews,
						[id]: parts.map((part) => part.imageUrl)
					};
				},
				editing
					? 'Changes saved in this browser.'
					: 'Draft saved in this browser.'
			)
		)
			editorOpen = false;
	}
	function attach(event: Event, index: number) {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;
		const file = event.currentTarget.files?.[0];
		if (!file) return;
		if (
			!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
				file.type
			) ||
			file.size > 10 * 1024 * 1024
		) {
			dialogError = 'Choose a JPEG, PNG, WebP, or GIF under 10 MB.';
			return;
		}
		const url = URL.createObjectURL(file);
		objectUrls.add(url);
		parts[index] = { ...parts[index], imageUrl: url };
		dialogError = '';
	}
	function openTime(post: DemoPost) {
		target = post.id;
		if (!store || !settings) return;
		chosenTime = localInput(
			post.status.kind === 'queued'
				? post.status.at
				: store.next(channel, post.id),
			settings.timeZone
		);
		dialogError = '';
		timeOpen = true;
	}
	function saveTime() {
		if (!settings || !target) return;
		if (
			run((demo) => {
				if (!target) return;
				demo.schedule(
					target,
					parseLocal(chosenTime, demo.state.settings[channel].timeZone)
				);
			}, 'Time saved. Nothing will post online.')
		)
			timeOpen = false;
	}
	function selectPost(id: string) {
		selected = id;
		const index = filtered.findIndex((post) => post.id === id);
		if (index >= 0) offset = Math.floor(index / 20) * 20;
	}
	function shiftDay(amount: number) {
		day = Temporal.PlainDate.from(day).add({ days: amount }).toString();
		offset = 0;
		selected = null;
	}
	function postParts(post: DemoPost) {
		return post.parts.map((part, index) => ({
			text: part.text,
			imageUrl: imagePreviews[post.id]?.[index]
		}));
	}
</script>

<div class="demo-shell">
	<div class="demo-banner">
		<a href="/" aria-label="Antre home">antre.</a><strong
			>Demo, nothing posts online</strong
		>
	</div>
	<header class="topbar">
		<h1>
			{view === 'drafts'
				? 'Drafts'
				: view === 'schedule'
					? 'Schedule'
					: 'Library'}
		</h1>
		<div class="channel-switch" aria-label="Posting channel">
			{#each channels as value}<button
					type="button"
					aria-pressed={channel === value}
					onclick={() => changeChannel(value)}
					>{value === 'threads' ? 'Threads' : 'LinkedIn'}</button
				>{/each}
		</div>
		<button
			class="icon-btn"
			type="button"
			aria-label="Demo posting settings"
			onclick={() => {
				if (settings)
					settingsForm = {
						...settings,
						windows: settings.windows.map((window) => ({ ...window }))
					};
				dialogError = '';
				settingsOpen = true;
			}}
			disabled={!demoState}><Icon name="settings" /></button
		>
	</header>
	<main>
		{#if !demoState || !settings}
			<div class="empty" role="status">
				<strong>Opening your demo…</strong>
				<p>Sample posts will appear here.</p>
			</div>
		{:else}
			<div class="intro-note">
				<p>Try a draft. Find it a time. See what happens.</p>
				<span>Sample posts · changes stay in this browser</span>
			</div>
			{#if storageNotice}<p class="storage-notice" role="status">
					<Icon name="alert" size={16} />{storageNotice}
				</p>{/if}
			{#if view === 'drafts'}
				<nav class="draft-views" aria-label="Draft views">
					<button
						type="button"
						aria-pressed={!recoveryOnly}
						onclick={() => {
							recoveryOnly = false;
							offset = 0;
						}}>Drafts <span class="num">{drafts.length}</span></button
					>
					<button
						type="button"
						aria-pressed={recoveryOnly}
						onclick={() => {
							recoveryOnly = true;
							offset = 0;
						}}
						>Needs attention <span class="num">{recovery.length}</span></button
					>
				</nav>
			{:else if view === 'schedule'}
				<div class="day-picker">
					<button
						class="icon-btn"
						type="button"
						aria-label="Previous day"
						onclick={() => shiftDay(-1)}><Icon name="left" size={18} /></button
					>
					<label
						><span class="sr-only">Schedule date</span><input
							aria-label="Schedule date"
							type="date"
							value={day}
							onchange={(event) => {
								if (event.currentTarget.value) {
									day = event.currentTarget.value;
									offset = 0;
									selected = null;
								}
							}}
						/></label
					>
					<button
						class="icon-btn"
						type="button"
						aria-label="Next day"
						onclick={() => shiftDay(1)}><Icon name="right" size={18} /></button
					>
					<button
						class="today"
						type="button"
						onclick={() => {
							day = dateKey(Date.now(), settings.timeZone);
							offset = 0;
						}}>Today</button
					>
				</div>
				<DemoTimeline
					{day}
					{settings}
					posts={marks}
					{next}
					{selected}
					onselect={selectPost}
				/>
				<div class="schedule-meta">
					<span>{settings.timeZone}</span><span class="num"
						>{schedulePosts.length} posts</span
					>
				</div>
			{:else}
				<div class="library-note">
					<strong>Simulated outcomes</strong>
					<p>
						These posts never left this browser. Your real account starts with
						an empty workspace.
					</p>
				</div>
			{/if}
			{#if view === 'drafts' && next !== null}<p class="next-slot">
					Next free slot <strong>{when(next, settings.timeZone)}</strong> · {settings.timeZone}
				</p>{/if}
			<div class="tools">
				<label class="search"
					><Icon name="search" size={16} /><input
						type="search"
						aria-label="Search demo posts"
						placeholder="Search {channelName} posts"
						bind:value={search}
						oninput={() => (offset = 0)}
					/></label
				>
				<button
					class="icon-btn write"
					type="button"
					aria-label="Write a demo post"
					onclick={() => compose()}><Icon name="plus" /></button
				>
			</div>
			{#each pagePosts as post (post.id)}
				<Post
					parts={postParts(post)}
					username={channel === 'threads'
						? 'mira.sample'
						: 'Mira · Sample profile'}
					selected={selected === post.id}
					id="demo-{post.id}"
				>
					{#snippet head()}
						<span
							class="post-status"
							class:failed={post.status.kind === 'failed'}
							class:held={post.status.kind === 'held'}
							class:published={post.status.kind === 'published'}
							>{post.status.kind === 'published'
								? 'Simulated'
								: post.status.kind === 'draft'
									? 'Draft'
									: post.status.kind === 'queued'
										? 'Queued'
										: post.status.kind === 'held'
											? 'Held'
											: 'Failed'}</span
						>
					{/snippet}
					{#snippet sub()}
						{#if post.status.kind !== 'draft'}<p class="post-time">
								{when(post.status.at, settings.timeZone)} · {settings.timeZone}
							</p>{/if}
						{#if post.status.kind === 'failed' || post.status.kind === 'held'}<p
								class="reason"
								class:failed={post.status.kind === 'failed'}
								class:held={post.status.kind === 'held'}
							>
								{post.status.reason}
							</p>{/if}
					{/snippet}
					{#if post.status.kind === 'draft'}
						<button
							class="act"
							type="button"
							onclick={() =>
								run(
									(demo) => demo.queue(post.id),
									'Added to the next free demo slot. Open Schedule to move or simulate it.'
								)}><Icon name="queue" size={17} />Queue</button
						>
					{:else if post.status.kind === 'failed' || post.status.kind === 'held'}
						<button
							class="act"
							type="button"
							onclick={() =>
								run(
									(demo) => demo.retry(post.id),
									'Retry placed in the demo queue. Open Schedule to simulate an outcome.'
								)}><Icon name="undo" size={17} />Retry</button
						>
					{/if}
					{#if post.status.kind !== 'published'}
						<button class="act" type="button" onclick={() => openTime(post)}
							><Icon name="clock" size={17} />{post.status.kind === 'queued'
								? 'Move'
								: 'Choose time'}</button
						>
						<button class="act" type="button" onclick={() => compose(post)}
							><Icon name="edit" size={17} />Edit</button
						>
					{/if}
					{#if post.status.kind === 'queued'}
						<button
							class="act"
							type="button"
							onclick={() => {
								target = post.id;
								dialogError = '';
								simulationOpen = true;
							}}><Icon name="send" size={17} />Simulate</button
						>
						<button
							class="act"
							type="button"
							onclick={() => {
								target = post.id;
								dialogError = '';
								swapOpen = true;
							}}
							disabled={!queued.some((other) => other.id !== post.id)}
							><Icon name="swap" size={17} />Swap</button
						>
						<button
							class="act"
							type="button"
							onclick={() =>
								run((demo) => demo.unqueue(post.id), 'Returned to Drafts.')}
							><Icon name="undo" size={17} />Unqueue</button
						>
					{:else if post.status.kind === 'published'}
						<span class="local-outcome"
							><Icon name="check" size={14} />Stored local outcome · no online
							post</span
						>
					{/if}
				</Post>
			{:else}
				<div class="empty">
					<strong
						>{search
							? 'No posts match your search.'
							: view === 'schedule'
								? 'There’s room in this day.'
								: view === 'library'
									? 'No simulated posts yet.'
									: recoveryOnly
										? 'No posts need attention.'
										: 'A clear page for your next thought.'}</strong
					>
					<p>
						{search
							? 'Try another phrase or clear the search.'
							: view === 'schedule'
								? 'Queue a draft or choose a time to put it here.'
								: view === 'library'
									? 'Open Schedule and simulate a queued post.'
									: recoveryOnly
										? 'Failed and held posts appear here for retry.'
										: 'Write a post, then add it to the queue.'}
					</p>
					{#if search}<button
							class="btn btn-secondary"
							type="button"
							onclick={() => (search = '')}>Clear search</button
						>{:else if view === 'drafts' && !recoveryOnly}<button
							class="btn btn-primary"
							type="button"
							onclick={() => compose()}>Write a post</button
						>{:else if view !== 'drafts'}<button
							class="btn btn-secondary"
							type="button"
							onclick={() =>
								changeView(view === 'schedule' ? 'drafts' : 'schedule')}
							>Open {view === 'schedule' ? 'Drafts' : 'Schedule'}</button
						>{/if}
				</div>
			{/each}
			{#if filtered.length > 20}
				<nav class="pager" aria-label="Post pages">
					<button
						class="btn btn-secondary"
						type="button"
						disabled={offset === 0}
						onclick={() => (offset -= 20)}>Previous</button
					><span class="num"
						>{offset + 1}–{Math.min(offset + 20, filtered.length)} of {filtered.length}</span
					><button
						class="btn btn-secondary"
						type="button"
						disabled={offset + 20 >= filtered.length}
						onclick={() => (offset += 20)}>Next</button
					>
				</nav>
			{/if}
			{#if view === 'library' && channel === 'threads'}
				<details class="sample-engagement">
					<summary>Explore sample replies and metrics</summary>
					<p class="sample-label">Sample data · not linked to your posts</p>
					<div class="sample-metrics">
						<span><strong>124</strong> views</span><span
							><strong>18</strong> likes</span
						><span><strong>2</strong> replies</span>
					</div>
					<p class="sample-reply">
						<strong>rowan.sample</strong><br />I’m trying this with our next
						project.
					</p>
					<p class="sample-reply">
						<strong>alex.sample</strong><br />The open question is the part we
						used to miss.
					</p>
				</details>
			{/if}
			<aside class="start-real">
				<strong>Make room for your own posts.</strong>
				<p>
					Your account starts with an empty workspace. Demo posts and settings
					stay here.
				</p>
				<a class="btn btn-secondary" href="/login?screen_hint=sign-up"
					>Create account</a
				>
				<div class="demo-links">
					<button type="button" onclick={() => (resetOpen = true)}
						>Reset demo</button
					><a href="/privacy">Privacy</a><a href="/">About Antre</a>
				</div>
			</aside>
		{/if}
	</main>
	{#if notice}<div class="notice" role="status">
			<p>{notice}</p>
			<button
				class="icon-btn"
				type="button"
				aria-label="Dismiss message"
				onclick={() => (notice = '')}><Icon name="close" size={16} /></button
			>
		</div>{/if}
	<nav class="demo-tabs" aria-label="Demo views">
		<button
			type="button"
			aria-current={view === 'drafts' ? 'page' : undefined}
			onclick={() => changeView('drafts')}
			><Icon name="drafts" /><span>Drafts</span></button
		>
		<button
			type="button"
			aria-current={view === 'schedule' ? 'page' : undefined}
			onclick={() => changeView('schedule')}
			><Icon name="schedule" /><span>Schedule</span></button
		>
		<button
			class="compose-tab"
			type="button"
			aria-label="Write a demo post"
			disabled={!demoState}
			onclick={() => compose()}
			><span><Icon name="plus" /></span><span>Write</span></button
		>
		<button
			type="button"
			aria-current={view === 'library' ? 'page' : undefined}
			onclick={() => changeView('library')}
			><Icon name="library" /><span>Library</span></button
		>
	</nav>
</div>

<Sheet
	bind:open={editorOpen}
	title={editing ? `Edit ${channelName} post` : `Write for ${channelName}`}
>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		<p class="sheet-note">
			Demo only. Text stays in this browser.{channel === 'threads'
				? ' Up to 500 characters per part.'
				: ' Up to 3,000 characters.'}
		</p>
		{#each parts as part, index}
			<div class="compose-part">
				<div class="part-heading">
					<label for="demo-part-{index}"
						>{channel === 'threads' ? `Part ${index + 1}` : 'Post text'}</label
					><span class="num" class:failed={[...part.text.trim()].length > limit}
						>{[...part.text.trim()].length}/{limit}</span
					>{#if parts.length > 1}<button
							type="button"
							class="icon-btn"
							aria-label="Remove part {index + 1}"
							onclick={() =>
								(parts = parts.filter((_, partIndex) => partIndex !== index))}
							><Icon name="close" size={16} /></button
						>{/if}
				</div>
				<textarea
					id="demo-part-{index}"
					placeholder={index === 0
						? 'What’s on your mind?'
						: 'Continue the thought…'}
					bind:value={part.text}
					rows="5"
					aria-invalid={[...part.text.trim()].length > limit}></textarea>
				{#if channel === 'threads'}
					{#if part.imageUrl}<div class="image-preview">
							<img
								src={part.imageUrl}
								alt="Local preview for part {index + 1}"
							/><button
								class="btn btn-secondary"
								type="button"
								onclick={() => (parts[index] = { text: part.text })}
								>Remove image</button
							>
						</div>{:else}<label class="attach"
							><Icon name="image" size={17} />Add image<input
								type="file"
								accept="image/jpeg,image/png,image/webp,image/gif"
								aria-label="Add image to part {index + 1}"
								onchange={(event) => attach(event, index)}
							/></label
						>{/if}
				{/if}
			</div>
		{/each}
		{#if channel === 'threads'}<div class="part-tools">
				<button
					class="act"
					type="button"
					disabled={parts.length >= 20}
					onclick={() => (parts = [...parts, { text: '' }])}
					><Icon name="plus" size={17} />Add part</button
				><span>Image previews disappear when this page closes.</span>
			</div>{/if}
		{#if dialogError}<p class="dialog-error" role="alert">{dialogError}</p>{/if}
		<button
			class="btn btn-primary btn-block"
			type="submit"
			disabled={invalidContent}
			>{editing ? 'Save changes' : 'Save draft'}</button
		>
	</form>
</Sheet>

<Sheet
	bind:open={timeOpen}
	title={targetPost?.status.kind === 'queued' ? 'Move post' : 'Choose a time'}
>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			saveTime();
		}}
	>
		<p class="sheet-note">
			Choose a future time in {settings?.timeZone}. The post stays in the demo.
		</p>
		<label class="field-label" for="demo-time">Date and time</label><input
			id="demo-time"
			class="field"
			type="datetime-local"
			required
			bind:value={chosenTime}
		/>
		{#if dialogError}<p class="dialog-error" role="alert">{dialogError}</p>{/if}
		<button class="btn btn-primary btn-block spaced" type="submit"
			>Save time</button
		>
	</form>
</Sheet>

<Sheet bind:open={swapOpen} title="Swap queue times">
	<p class="sheet-note">
		Choose another {channelName} post. Both posts keep their text.
	</p>
	{#each swappable as post}
		<button
			type="button"
			class="swap-option"
			onclick={() => {
				if (
					target &&
					run((demo) => {
						if (target) demo.swap(target, post.id);
					}, 'Queue times swapped.')
				)
					swapOpen = false;
			}}
			><strong
				>{post.status.kind === 'queued' && settings
					? when(post.status.at, settings.timeZone)
					: ''}</strong
			><span>{post.parts[0]?.text}</span></button
		>
	{:else}<p class="sheet-note">Queue a second post to swap times.</p>{/each}
	{#if dialogError}<p class="dialog-error" role="alert">{dialogError}</p>{/if}
</Sheet>

<Sheet bind:open={simulationOpen} title="Simulate a publish">
	<p class="sheet-note">
		Pick the local outcome. No account is connected and nothing posts online.
	</p>
	{#each ['published', 'failed', 'held'] as outcome}
		<button
			type="button"
			class="outcome-option"
			onclick={() => {
				if (
					outcome !== 'published' &&
					outcome !== 'failed' &&
					outcome !== 'held'
				)
					return;
				if (
					target &&
					run(
						(demo) => {
							if (target) demo.simulate(target, outcome);
						},
						outcome === 'published'
							? 'Simulated publish stored in Library. Nothing posted online.'
							: 'Local outcome saved. Open Drafts → Needs attention to retry.'
					)
				)
					simulationOpen = false;
			}}
			><Icon
				name={outcome === 'published' ? 'check' : 'alert'}
				size={20}
			/><span
				><strong
					>{outcome === 'published'
						? 'Mark as published'
						: outcome === 'failed'
							? 'Simulate failure'
							: 'Simulate a hold'}</strong
				><small
					>{outcome === 'published'
						? 'Store a simulated result in Library'
						: outcome === 'failed'
							? 'Try the retry flow after a rejected attempt'
							: 'Try the retry flow after a connection hold'}</small
				></span
			><Icon name="right" size={16} /></button
		>
	{/each}
	{#if dialogError}<p class="dialog-error" role="alert">{dialogError}</p>{/if}
</Sheet>

<Sheet bind:open={settingsOpen} title="Demo posting settings">
	<form
		onsubmit={(event) => {
			event.preventDefault();
			if (
				run(
					(demo) => demo.updateSettings(channel, settingsForm),
					'Posting settings saved. Existing queued times stay fixed.'
				)
			)
				settingsOpen = false;
		}}
	>
		<p class="sheet-note">
			For {channelName} in this demo. Changes apply to the next queue action. Existing
			queued instants stay fixed.
		</p>
		<label class="field-label" for="demo-timezone">Time zone</label><input
			id="demo-timezone"
			class="field"
			list="demo-zones"
			required
			bind:value={settingsForm.timeZone}
			placeholder="Area/City"
		/>
		<datalist id="demo-zones"
			><option value="Asia/Jakarta"></option><option value="Asia/Tokyo"
			></option><option value="Europe/London"></option><option
				value="Europe/Berlin"
			></option><option value="America/New_York"></option><option
				value="America/Los_Angeles"
			></option><option value="Australia/Sydney"></option><option value="UTC"
			></option></datalist
		>
		<label class="field-label spaced" for="demo-interval"
			>Minutes between slots</label
		><input
			id="demo-interval"
			class="field"
			type="number"
			min="5"
			max="240"
			step="1"
			required
			bind:value={settingsForm.intervalMinutes}
		/>
		<h3 class="windows-title">Posting windows</h3>
		{#each settingsForm.windows as window, index}
			<div class="window-row">
				<label
					><span>Start {index + 1}</span><input
						class="field"
						type="time"
						required
						bind:value={window.start}
					/></label
				><span aria-hidden="true">–</span><label
					><span>End {index + 1}</span><input
						class="field"
						type="time"
						required
						bind:value={window.end}
					/></label
				><button
					type="button"
					class="icon-btn"
					disabled={settingsForm.windows.length === 1}
					aria-label="Remove posting window {index + 1}"
					onclick={() =>
						(settingsForm.windows = settingsForm.windows.filter(
							(_, row) => row !== index
						))}><Icon name="close" size={16} /></button
				>
			</div>
		{/each}
		<button
			class="act"
			type="button"
			disabled={settingsForm.windows.length >= 12}
			onclick={() =>
				(settingsForm.windows = [
					...settingsForm.windows,
					{ start: '19:00', end: '20:00' }
				])}><Icon name="plus" size={17} />Add window</button
		>
		<p class="sheet-note">
			Window endpoints include a slot. Clocks changing? Missing local times are
			skipped; repeated times use their first occurrence.
		</p>
		{#if dialogError}<p class="dialog-error" role="alert">{dialogError}</p>{/if}
		<button class="btn btn-primary btn-block" type="submit"
			>Save settings</button
		>
	</form>
</Sheet>

<Sheet bind:open={resetOpen} title="Reset this demo?">
	<p class="sheet-note">
		Replace your local drafts, queue, settings, and simulated outcomes with the
		sample posts. Your real workspace is separate.
	</p>
	<button
		class="btn btn-primary btn-block"
		type="button"
		onclick={() => {
			if (run((demo) => demo.reset(), 'Demo reset. Sample posts restored.')) {
				for (const url of objectUrls) URL.revokeObjectURL(url);
				objectUrls.clear();
				imagePreviews = {};
				channel = 'threads';
				recoveryOnly = false;
				changeView('drafts');
				if (store)
					day = dateKey(
						store.next(channel),
						store.state.settings[channel].timeZone
					);
				resetOpen = false;
			}
		}}>Reset demo</button
	>
</Sheet>

<style>
	.demo-shell {
		max-width: 600px;
		min-height: 100dvh;
		margin: 0 auto;
		padding-bottom: calc(80px + var(--safe-b));
		border-inline: 1px solid var(--line);
	}
	.demo-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 42px;
		padding: 6px 16px;
		background: var(--bg-2);
		font-size: 12px;
	}
	.demo-banner a {
		font-size: 20px;
		font-weight: 750;
		letter-spacing: -0.04em;
		text-decoration: none;
	}
	.demo-banner strong {
		font-weight: 500;
	}
	.topbar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 60px;
		padding: 0 12px 0 16px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}
	h1 {
		margin-right: auto;
		font-size: 20px;
		line-height: 24px;
		letter-spacing: -0.02em;
	}
	.channel-switch {
		display: flex;
		gap: 2px;
		padding: 3px;
		border-radius: 999px;
		background: var(--bg-2);
	}
	.channel-switch button {
		min-height: 32px;
		padding: 0 12px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		color: var(--fg-2);
	}
	.channel-switch button[aria-pressed='true'] {
		background: var(--fg);
		color: var(--on-fg);
	}
	.intro-note {
		padding: 20px 16px 16px;
	}
	.intro-note p {
		font-weight: 600;
	}
	.intro-note span {
		display: block;
		margin-top: 4px;
		font-size: 12px;
		color: var(--fg-2);
	}
	.storage-notice {
		display: flex;
		gap: 8px;
		padding: 12px 16px;
		background: var(--amber-bg);
		color: var(--amber);
		font-size: 13px;
	}
	.storage-notice :global(svg) {
		flex: none;
		margin-top: 2px;
	}
	.draft-views {
		display: flex;
		gap: 24px;
		padding-inline: 16px;
		border-bottom: 1px solid var(--line);
	}
	.draft-views button {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		border-bottom: 1.5px solid transparent;
		color: var(--fg-2);
		font-size: 13px;
		font-weight: 600;
	}
	.draft-views button[aria-pressed='true'] {
		border-color: var(--fg);
		color: var(--fg);
	}
	.draft-views .num {
		font-weight: 400;
	}
	.next-slot {
		padding: 12px 16px 0;
		font-size: 12px;
		color: var(--fg-2);
		font-variant-numeric: tabular-nums;
	}
	.next-slot strong {
		font-weight: 500;
		color: var(--fg);
	}
	.tools {
		display: flex;
		gap: 8px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding-inline: 12px;
		background: var(--bg-2);
		border-radius: 10px;
		color: var(--fg-2);
	}
	.search:focus-within {
		outline: 1px solid var(--line-2);
	}
	.search input {
		width: 100%;
		min-width: 0;
		height: 36px;
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--fg);
		outline: none;
		font-size: 13px;
	}
	.write {
		background: var(--bg-2);
		border-radius: 10px;
	}
	.day-picker {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 12px;
	}
	.day-picker input {
		min-height: 40px;
		width: 156px;
		border: 0;
		padding: 0 4px;
		background: var(--bg);
		font-size: 15px;
		font-weight: 600;
	}
	.today {
		min-height: 40px;
		margin-left: auto;
		padding-inline: 12px;
		font-size: 13px;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.schedule-meta {
		display: flex;
		justify-content: space-between;
		padding: 8px 16px;
		font-size: 12px;
		color: var(--fg-2);
		border-bottom: 1px solid var(--line);
	}
	.library-note {
		padding: 0 16px 12px;
	}
	.library-note strong {
		font-size: 13px;
	}
	.library-note p {
		margin-top: 4px;
		font-size: 13px;
		color: var(--fg-2);
	}
	.post-status {
		margin-left: auto;
		color: var(--fg-2);
		font-size: 12px;
	}
	.post-time {
		font-size: 12px;
		color: var(--fg-2);
		margin-bottom: 4px;
	}
	.reason {
		margin: 4px 0 8px;
		font-size: 13px;
		line-height: 1.45;
	}
	.failed {
		color: var(--red);
	}
	.held {
		color: var(--amber);
	}
	.published {
		color: var(--green);
	}
	.local-outcome {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		min-height: 28px;
		color: var(--fg-2);
	}
	.empty {
		display: grid;
		justify-items: center;
		gap: 8px;
		padding: 48px 24px;
		text-align: center;
	}
	.empty p {
		max-width: 35ch;
		color: var(--fg-2);
		font-size: 13px;
	}
	.empty .btn {
		margin-top: 8px;
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 16px;
		font-size: 12px;
		color: var(--fg-2);
	}
	.pager .btn {
		font-size: 13px;
	}
	.start-real {
		padding: 28px 16px;
		border-top: 1px solid var(--line);
	}
	.start-real > strong {
		font-size: 17px;
	}
	.start-real > p {
		max-width: 48ch;
		margin: 6px 0 16px;
		font-size: 13px;
		color: var(--fg-2);
	}
	.demo-links {
		display: flex;
		gap: 20px;
		margin-top: 24px;
		color: var(--fg-2);
		font-size: 12px;
	}
	.demo-links button {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.demo-tabs {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		position: fixed;
		inset: auto 0 0;
		z-index: 6;
		max-width: 600px;
		margin-inline: auto;
		padding: 4px 12px calc(4px + var(--safe-b));
		min-height: 60px;
		border-top: 1px solid var(--line);
		background: var(--bg);
	}
	.demo-tabs button {
		display: flex;
		flex-direction: column;
		gap: 3px;
		align-items: center;
		justify-content: center;
		min-height: 52px;
		color: var(--fg-2);
		font-size: 10px;
	}
	.demo-tabs button[aria-current='page'] {
		color: var(--fg);
		font-weight: 700;
	}
	.compose-tab > span:first-child {
		display: grid;
		place-items: center;
		width: 40px;
		height: 30px;
		border-radius: 10px;
		background: var(--bg-2);
		color: var(--fg);
	}
	.notice {
		position: fixed;
		z-index: 7;
		bottom: calc(68px + var(--safe-b));
		left: 12px;
		right: 12px;
		max-width: 560px;
		margin-inline: auto;
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 10px 12px 10px 16px;
		border: 1px solid var(--line-2);
		border-radius: 10px;
		background: var(--bg-sheet);
		font-size: 13px;
	}
	.notice p {
		flex: 1;
	}
	.sheet-note {
		margin: 0 0 16px;
		color: var(--fg-2);
		font-size: 13px;
		line-height: 1.5;
	}
	.compose-part {
		padding-block: 12px;
		border-top: 1px solid var(--line);
	}
	.part-heading {
		display: flex;
		align-items: center;
		min-height: 36px;
		gap: 8px;
		margin-bottom: 6px;
		font-size: 12px;
		color: var(--fg-2);
	}
	.part-heading label {
		margin-right: auto;
		font-weight: 600;
		color: var(--fg);
	}
	textarea {
		display: block;
		width: 100%;
		min-height: 120px;
		max-height: 40dvh;
		resize: vertical;
		padding: 12px;
		border: 1px solid transparent;
		border-radius: 10px;
		background: var(--bg-2);
		line-height: 1.5;
	}
	textarea:focus {
		outline: 1px solid var(--line-2);
	}
	textarea[aria-invalid='true'] {
		border-color: var(--red);
	}
	.attach {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		font-size: 13px;
		margin-top: 4px;
		cursor: pointer;
	}
	.attach input {
		position: absolute;
		inset: 0;
		width: 100%;
		opacity: 0;
		cursor: pointer;
	}
	.attach:focus-within {
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
	.image-preview img {
		display: block;
		max-width: 100%;
		max-height: 240px;
		margin: 12px 0;
		border-radius: 8px;
	}
	.image-preview .btn {
		font-size: 13px;
	}
	.part-tools {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		padding-bottom: 20px;
	}
	.part-tools > span {
		font-size: 12px;
		color: var(--fg-2);
	}
	.dialog-error {
		margin: 12px 0;
		font-size: 13px;
		color: var(--red);
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
	.field-label {
		display: block;
		font-size: 13px;
		font-weight: 600;
		margin-bottom: 8px;
	}
	.spaced {
		margin-top: 20px;
	}
	.swap-option {
		display: block;
		width: 100%;
		text-align: left;
		padding: 16px 0;
		border-bottom: 1px solid var(--line);
	}
	.swap-option strong {
		display: block;
		margin-bottom: 4px;
		font-size: 13px;
	}
	.swap-option span {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.swap-option:hover {
		background: var(--press);
	}
	.outcome-option {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 12px;
		min-height: 76px;
		text-align: left;
		border-top: 1px solid var(--line);
	}
	.outcome-option > span {
		flex: 1;
	}
	.outcome-option strong {
		display: block;
		font-size: 15px;
	}
	.outcome-option small {
		display: block;
		margin-top: 4px;
		font-size: 12px;
		color: var(--fg-2);
	}
	.outcome-option:hover {
		background: var(--press);
	}
	.windows-title {
		margin: 24px 0 8px;
		font-size: 15px;
	}
	.window-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) 36px;
		align-items: end;
		gap: 8px;
		margin-bottom: 12px;
	}
	.window-row label span {
		display: block;
		margin-bottom: 4px;
		font-size: 12px;
		color: var(--fg-2);
	}
	.window-row > span {
		align-self: center;
		padding-top: 20px;
		color: var(--fg-2);
	}
	.window-row .icon-btn {
		margin-bottom: 2px;
	}
	.sample-engagement {
		border-block: 1px solid var(--line);
		padding: 16px;
	}
	.sample-engagement summary {
		cursor: pointer;
		font-size: 13px;
		font-weight: 600;
	}
	.sample-label {
		color: var(--fg-2);
		margin-top: 12px;
		font-size: 12px;
	}
	.sample-metrics {
		display: flex;
		gap: 24px;
		padding-block: 16px;
		color: var(--fg-2);
		font-size: 12px;
	}
	.sample-metrics strong {
		color: var(--fg);
		font-variant-numeric: tabular-nums;
	}
	.sample-reply {
		border-top: 1px solid var(--line);
		padding-top: 12px;
		margin-top: 12px;
		font-size: 13px;
	}
	@media (max-width: 360px) {
		.topbar {
			padding-inline: 12px 8px;
			gap: 4px;
		}
		.channel-switch button {
			padding-inline: 8px;
		}
		.demo-banner {
			padding-inline: 12px;
			gap: 8px;
		}
		.demo-banner strong {
			font-size: 12px;
		}
	}
</style>
