<script lang="ts">
	import { enhance } from '$app/forms';
	import { act } from '#lib/toast.svelte.ts';
	import { when, localInput } from '#lib/time.ts';
	import Icon from '#lib/components/Icon.svelte';
	import Post from '#lib/components/Post.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const title = $derived(
		data.view === 'scheduled'
			? 'Schedule'
			: data.view === 'published'
				? 'Library'
				: data.view === 'failed'
					? 'Failed'
					: 'Drafts'
	);
	const connected = $derived(
		data.connection &&
			!data.connection.needsReconnect &&
			data.connection.tokenExpiresAt > Date.now()
	);
</script>

<svelte:head><title>{title} · LinkedIn · antre</title></svelte:head>
<TopBar {title}
	><a class="icon-btn" href="/linkedin/settings" aria-label="LinkedIn settings"
		><Icon name="settings" /></a
	></TopBar
>

{#if !connected}
	<div class="notice">
		<strong
			>{data.connection
				? 'Reconnect LinkedIn'
				: 'Connect your personal profile'}</strong
		>
		<p>Your drafts stay here. Scheduled posts wait for a connection.</p>
		<a class="act" href="/linkedin/settings"
			>Open LinkedIn settings <Icon name="right" size={16} /></a
		>
	</div>
{/if}

{#if data.view === 'drafts' || data.view === 'failed'}
	<nav class="views" aria-label="LinkedIn draft views">
		<a
			href="/linkedin"
			aria-current={data.view === 'drafts' ? 'page' : undefined}
			>Drafts <span class="num">{data.counts.drafts}</span></a
		><a
			href="/linkedin?view=failed"
			aria-current={data.view === 'failed' ? 'page' : undefined}
			>Failed <span class="num">{data.counts.failed}</span></a
		>
	</nav>
{/if}
{#if data.view === 'scheduled'}<p class="queue-note">
		Next free slot: <strong>{when(data.nextSlot)}</strong> · WIB
	</p>{/if}

{#each data.items as item (item.id)}
	<Post parts={[{ text: item.text }]} username={data.connection?.name ?? 'You'}>
		{#snippet head()}<span class="destination">LinkedIn · Personal profile</span
			>{/snippet}
		{#snippet sub()}
			{#if item.topic}<p class="metadata">{item.topic}</p>{/if}
			{#if item.notes}<p class="metadata">{item.notes}</p>{/if}
			{#if item.status.kind !== 'draft'}<p class="metadata">
					{when(item.status.at)} · {item.status.kind === 'held'
						? 'Held'
						: item.status.kind === 'publishing'
							? 'Publishing…'
							: item.status.kind === 'published'
								? 'Published'
								: item.status.kind === 'failed'
									? 'Failed'
									: 'Scheduled'}
				</p>{/if}
			{#if item.status.kind === 'failed' || item.status.kind === 'held'}<p
					class="problem"
				>
					{item.status.error}
				</p>{/if}
		{/snippet}
		{#if item.status.kind === 'draft' || item.status.kind === 'failed'}
			<form method="POST" action="?/post" use:enhance={act()}>
				<input type="hidden" name="id" value={item.id} /><button
					class="act"
					name="operation"
					value="queue"><Icon name="queue" size={18} />Queue</button
				>
			</form>
			<a class="act" href="/linkedin/compose?edit={item.id}"
				><Icon name="edit" size={18} />Edit</a
			>
			<details class="schedule">
				<summary class="act"><Icon name="clock" size={18} />Choose time</summary
				>
				<form method="POST" action="?/post" use:enhance={act()}>
					<input type="hidden" name="id" value={item.id} /><input
						class="field"
						type="datetime-local"
						name="at"
						value={localInput(data.nextSlot)}
						min={localInput(Date.now())}
						aria-label="LinkedIn publish time in WIB"
						required
					/><button class="btn btn-primary" name="operation" value="queue"
						>Schedule on LinkedIn</button
					>
				</form>
			</details>
		{:else if item.status.kind === 'queued'}
			<form method="POST" action="?/post" use:enhance={act()}>
				<input type="hidden" name="id" value={item.id} /><button
					class="act"
					name="operation"
					value="unqueue"><Icon name="undo" size={18} />Return to drafts</button
				>
			</form>
		{:else if item.status.kind === 'published'}
			<a
				class="act"
				href={item.status.permalink}
				target="_blank"
				rel="noreferrer">View on LinkedIn <Icon name="right" size={16} /></a
			>
		{:else if item.status.kind === 'held' && item.status.reason === 'unknown'}
			<form class="uncertain" method="POST" action="?/post" use:enhance={act()}>
				<input type="hidden" name="id" value={item.id} /><input
					type="hidden"
					name="retryAttempt"
					value={item.status.startedAt}
				/>
				<p>
					LinkedIn may have published this post. Check your profile before
					sending it again.
				</p>
				<label
					><input type="checkbox" name="confirmDuplicateRisk" required />I
					checked my profile and want to publish again.</label
				><button class="btn btn-secondary" name="operation" value="retry"
					>Publish again on LinkedIn</button
				>
			</form>
		{/if}
		{#if item.status.kind === 'draft' || item.status.kind === 'failed'}<form
				method="POST"
				action="?/post"
				use:enhance={act()}
			>
				<input type="hidden" name="id" value={item.id} /><button
					class="act muted"
					name="operation"
					value="deletePost">Delete</button
				>
			</form>{/if}
	</Post>
{:else}
	<div class="empty">
		<strong
			>{data.view === 'published'
				? 'Your LinkedIn library starts here.'
				: data.view === 'scheduled'
					? 'No LinkedIn posts scheduled.'
					: data.view === 'failed'
						? 'No failed LinkedIn posts.'
						: 'Write for your LinkedIn audience.'}</strong
		>
		<p class="muted">
			{data.view === 'drafts'
				? 'These drafts have their own topics and writing preferences.'
				: data.view === 'published'
					? 'Posts published through Antre appear here.'
					: data.view === 'scheduled'
						? 'Queue a draft or choose its publish time.'
						: 'Rejected posts appear here for editing.'}
		</p>
		{#if data.view !== 'failed'}<a
				class="btn btn-primary"
				href="/linkedin/compose">New LinkedIn post</a
			>{/if}
	</div>
{/each}

{#if data.total > data.limit}<nav
		class="pager num"
		aria-label="LinkedIn post pages"
	>
		{#if data.offset > 0}<a
				class="act"
				href="/linkedin?view={data.view}&offset={Math.max(
					0,
					data.offset - data.limit
				)}">Previous</a
			>{/if}<span
			>{data.offset + 1}–{Math.min(data.offset + data.limit, data.total)} of {data.total}</span
		>{#if data.offset + data.limit < data.total}<a
				class="act"
				href="/linkedin?view={data.view}&offset={data.offset + data.limit}"
				>Next</a
			>{/if}
	</nav>{/if}

<style>
	.notice {
		padding: 16px;
		border-bottom: 1px solid var(--line);
		font-size: 13px;
	}
	.notice p {
		color: var(--fg-2);
		margin: 4px 0 8px;
	}
	.views {
		display: flex;
		gap: 20px;
		padding: 0 16px;
		border-bottom: 1px solid var(--line);
	}
	.views a {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		text-decoration: none;
		color: var(--fg-2);
		border-bottom: 1px solid transparent;
	}
	.views a[aria-current] {
		color: var(--fg);
		border-color: var(--fg);
	}
	.views span,
	.metadata,
	.destination {
		font-size: 12px;
		color: var(--fg-2);
	}
	.metadata {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.problem {
		color: var(--red);
		font-size: 13px;
		margin: 4px 0;
	}
	.queue-note {
		padding: 12px 16px;
		color: var(--fg-2);
		font-size: 13px;
		border-bottom: 1px solid var(--line);
	}
	.empty {
		display: grid;
		justify-items: center;
		gap: 8px;
		padding: 64px 24px;
		text-align: center;
	}
	.empty .btn {
		margin-top: 12px;
	}
	.schedule {
		position: relative;
	}
	summary {
		list-style: none;
		cursor: pointer;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.schedule[open] {
		flex-basis: 100%;
	}
	.schedule form {
		display: grid;
		gap: 8px;
		padding: 8px 0 12px;
	}
	.uncertain {
		display: grid;
		gap: 12px;
		padding: 8px 0;
		font-size: 13px;
	}
	.uncertain label {
		display: flex;
		align-items: start;
		gap: 8px;
	}
	.uncertain input {
		margin-top: 3px;
	}
	.pager {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 16px;
		padding: 20px 16px;
		font-size: 13px;
	}
</style>
