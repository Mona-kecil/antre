<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { act } from '#lib/toast.svelte.ts';
	import { ago } from '#lib/time.ts';
	import Flag from '#lib/components/Flag.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import type { PageProps } from './$types';

	const LIMIT = 20;
	let { data }: PageProps = $props();
	const me = $derived(data.account?.username ?? 'you');
	const view = $derived(page.url.searchParams.get('view') === 'new' ? 'new' : 'drafted');
	const drafted = $derived(data.replies.filter((reply) => reply.draft !== null || reply.sending !== null));
	const fresh = $derived(data.replies.filter((reply) => reply.draft === null && reply.sending === null));
	const list = $derived(view === 'new' ? fresh : drafted);
	const pageNo = $derived(Math.max(1, Number(page.url.searchParams.get('page')) || 1));
	const offset = $derived(Math.min((pageNo - 1) * LIMIT, Math.floor(Math.max(0, list.length - 1) / LIMIT) * LIMIT));
	const shown = $derived(list.slice(offset, offset + LIMIT));
	const now = $derived.by(() => {
		void data.replies;
		return Date.now();
	});
	let edits = $state<Record<string, string>>({});
	const length = (text: string) => [...text].length;

	function autosize(node: HTMLTextAreaElement) {
		const fit = () => {
			node.style.height = 'auto';
			node.style.height = `${node.scrollHeight}px`;
		};
		fit();
		node.addEventListener('input', fit);
		return { destroy: () => node.removeEventListener('input', fit) };
	}
</script>

<svelte:head><title>Replies · antre</title></svelte:head>

<TopBar title="Replies">
	<span class="synced muted">
		{data.syncedAt ? `Synced ${ago(Date.parse(data.syncedAt), now)}` : 'Never synced'}
	</span>
</TopBar>

<nav class="views" aria-label="Reply views">
	<a href="/replies" aria-current={view === 'drafted' ? 'page' : undefined}>
		To review <span class="num">{drafted.length}</span>
	</a>
	<a href="/replies?view=new" aria-current={view === 'new' ? 'page' : undefined}>
		Unanswered <span class="num">{fresh.length}</span>
	</a>
</nav>

{#each shown as reply (reply.replyId)}
	{@const saved = reply.draft ?? ''}
	{@const text = edits[reply.replyId] ?? saved}
	{@const changed = text !== saved}
	{@const count = length(text)}
	<article class="reply">
		<div class="row context">
			<span class="rail"><span class="avatar me">{me.slice(0, 1).toUpperCase()}</span></span>
			<div>
				<p class="who"><strong>{me}</strong></p>
				<p class="text">{reply.postText}</p>
				{#if reply.parentText !== null && reply.parentText !== reply.postText}
					<p class="parent"><span class="muted">Replying to</span> {reply.parentText}</p>
				{/if}
			</div>
		</div>
		<div class="row them">
			<span class="rail"><span class="avatar">{reply.username.slice(0, 1).toUpperCase()}</span></span>
			<div>
				<p class="who">
					<strong>{reply.username}</strong>
					<time class="muted" datetime={reply.at}>{ago(Date.parse(reply.at), now)}</time>
					{#if reply.hidden}<Flag icon="hide" text="Hidden" />{/if}
					{#if reply.permalink}
						<a class="open" href={reply.permalink} target="_blank" rel="noreferrer" aria-label="Open on Threads">
							<Icon name="external" size={16} />
						</a>
					{/if}
				</p>
				<p class="text">{reply.text}</p>
			</div>
		</div>
		<div class="row answer">
			<span class="rail"><span class="avatar me small">{me.slice(0, 1).toUpperCase()}</span></span>
			<div>
				{#if reply.sending !== null && reply.draft === null}
					<p class="text">{reply.sending}</p>
					<p class="note"><Icon name="send" size={14} />Sending. If it isn’t on Threads in 15 minutes, discard to unlock.</p>
					<form method="POST" action="?/reply" use:enhance={act()} class="actions">
						<input type="hidden" name="replyId" value={reply.replyId} />
						<button class="act" name="operation" value="discard"><Icon name="trash" size={18} />Discard</button>
					</form>
				{:else}
					<form
						method="POST"
						action="?/reply"
						use:enhance={act(() => delete edits[reply.replyId])}
					>
						<input type="hidden" name="replyId" value={reply.replyId} />
						<label class="sr-only" for="answer-{reply.replyId}">Your answer to {reply.username}</label>
						<textarea
							id="answer-{reply.replyId}"
							name="text"
							rows="1"
							value={text}
							use:autosize
							placeholder="Reply to {reply.username}…"
							oninput={(event) => (edits[reply.replyId] = event.currentTarget.value)}
						></textarea>
						<div class="meta">
							<span class="note">
								{#if changed && reply.draft !== null}
									Edited · save before sending
								{:else if reply.draft !== null}
									Sends exactly this text
								{/if}
							</span>
							<span class="count num" class:over={count > 500}>{count}/500</span>
						</div>
						{#if changed}
							<div class="actions">
								<button class="btn btn-secondary small" name="operation" value="save" disabled={!text.trim() || count > 500}>
									{reply.draft === null ? 'Save draft' : 'Save'}
								</button>
								{#if reply.draft !== null}
									<button type="button" class="act" onclick={() => delete edits[reply.replyId]}>Undo edits</button>
								{/if}
							</div>
						{/if}
					</form>
					{#if reply.draft !== null && !changed}
						<form method="POST" action="?/reply" use:enhance={act()} class="actions">
							<input type="hidden" name="replyId" value={reply.replyId} />
							<input type="hidden" name="text" value={reply.draft} />
							<button class="btn btn-primary small" name="operation" value="send"><Icon name="send" size={16} />Send</button>
							<button class="act discard" name="operation" value="discard">Discard</button>
						</form>
					{/if}
				{/if}
			</div>
		</div>
	</article>
{:else}
	<div class="empty">
		<p><strong>{view === 'new' ? 'No unanswered replies.' : 'Nothing to review.'}</strong></p>
		<p class="muted">
			{view === 'new'
				? 'New replies to your posts show up after the next sync.'
				: 'When your agent drafts an answer, it waits here for your OK.'}
		</p>
	</div>
{/each}

{#if list.length > LIMIT}
	<Pager total={list.length} {offset} limit={LIMIT} noun="replies" />
{/if}

<style>
	.synced {
		margin-right: 8px;
		font-size: 12px;
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
		gap: 6px;
		height: 44px;
		margin-bottom: -1px;
		color: var(--fg-2);
		font-weight: 600;
		text-decoration: none;
		border-bottom: 1.5px solid transparent;
	}

	.views a[aria-current='page'] {
		color: var(--fg);
		border-color: var(--fg);
	}

	.views .num {
		font-size: 13px;
		font-weight: 400;
		color: var(--fg-2);
	}

	.reply {
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
	}

	.row {
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr);
		column-gap: 12px;
		padding-bottom: 12px;
	}

	.row.answer {
		padding-bottom: 0;
	}

	.rail {
		position: relative;
		display: flex;
		justify-content: center;
	}

	.row:not(.answer) .rail::after {
		content: '';
		position: absolute;
		top: 42px;
		bottom: -8px;
		left: 50%;
		width: 2px;
		margin-left: -1px;
		border-radius: 1px;
		background: var(--line-2);
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--bg-2);
		color: var(--fg);
		font-size: 15px;
		font-weight: 700;
	}

	.avatar.me {
		background: var(--fg);
		color: var(--on-fg);
	}

	.avatar.small {
		width: 24px;
		height: 24px;
		margin-top: 2px;
		font-size: 11px;
	}

	.context .text,
	.context .who {
		color: var(--fg-2);
	}

	.context .text {
		font-size: 14px;
		line-height: 20px;
	}

	.who {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 20px;
	}

	.who strong {
		font-weight: 600;
	}

	.open {
		display: grid;
		place-items: center;
		margin-left: auto;
		color: var(--fg-2);
	}

	.text {
		margin-top: 2px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 21px;
	}

	.parent {
		margin-top: 6px;
		padding-left: 10px;
		border-left: 2px solid var(--line-2);
		font-size: 13px;
		line-height: 18px;
		color: var(--fg-2);
		white-space: pre-wrap;
	}

	textarea {
		display: block;
		width: 100%;
		min-height: 40px;
		padding: 8px 12px;
		border: 1px solid transparent;
		border-radius: 12px;
		background: var(--bg-2);
		line-height: 21px;
		resize: none;
		overflow: hidden;
		outline: none;
	}

	textarea:focus {
		border-color: var(--line-2);
	}

	.meta {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		margin-top: 4px;
		font-size: 12px;
	}

	.note {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--fg-2);
	}

	.count {
		color: var(--fg-3);
	}

	.count.over {
		color: var(--red);
		font-weight: 600;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 8px;
	}

	.small {
		height: 32px;
		padding: 0 14px;
		font-size: 14px;
	}

	.discard {
		color: var(--fg-2);
		margin-left: 0;
	}

	.empty {
		display: grid;
		justify-items: center;
		gap: 4px;
		padding: 64px 32px;
		text-align: center;
	}
</style>
