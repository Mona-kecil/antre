<script lang="ts">
	import { ago } from '#lib/displayTime.svelte.ts';
	import Icon from '../components/Icon.svelte';
	import TopBar from '../components/TopBar.svelte';
	import { username as me } from './fixtures';
	import type { Sandbox } from './sandbox.svelte';

	let { sandbox }: { sandbox: Sandbox } = $props();
	const view = $derived(sandbox.url.searchParams.get('view') === 'new' ? 'new' : 'drafted');
	const open = $derived(sandbox.state.replies.filter((reply) => reply.sent === null));
	const drafted = $derived(open.filter((reply) => reply.draft !== null));
	const fresh = $derived(open.filter((reply) => reply.draft === null));
	const shown = $derived(view === 'new' ? fresh : drafted);
	let edits = $state<Record<string, string>>({});
	const length = (text: string) => [...text].length;

	function autosize(node: HTMLTextAreaElement) {
		const fit = () => {
			node.style.height = 'auto';
			node.style.height = `${node.scrollHeight + 2}px`;
		};
		fit();
		node.addEventListener('input', fit);
		return { destroy: () => node.removeEventListener('input', fit) };
	}
</script>

<TopBar title="Replies" heading="h2" />

<nav class="views" aria-label="Reply views">
	<a href="/app/replies" aria-current={view === 'drafted' ? 'page' : undefined}>
		To review <span class="num">{drafted.length}</span>
	</a>
	<a href="/app/replies?view=new" aria-current={view === 'new' ? 'page' : undefined}>
		Unanswered <span class="num">{fresh.length}</span>
	</a>
</nav>

{#each shown as reply (reply.id)}
	{@const saved = reply.draft ?? ''}
	{@const text = edits[reply.id] ?? saved}
	{@const changed = text !== saved}
	{@const count = length(text)}
	<article class="reply">
		<div class="row context">
			<span class="rail"><span class="avatar me">{me.slice(0, 1).toUpperCase()}</span></span>
			<div>
				<p class="who"><strong>{me}</strong></p>
				<p class="text">{reply.postText}</p>
			</div>
		</div>
		<div class="row them">
			<span class="rail"><span class="avatar">{reply.username.slice(0, 1).toUpperCase()}</span></span>
			<div>
				<p class="who">
					<strong>{reply.username}</strong>
					<time class="muted" datetime={new Date(reply.at).toISOString()}>{ago(reply.at, sandbox.now)}</time>
				</p>
				<p class="text">{reply.text}</p>
			</div>
		</div>
		<div class="row answer">
			<span class="rail"><span class="avatar me small">{me.slice(0, 1).toUpperCase()}</span></span>
			<div>
				<label class="sr-only" for="answer-{reply.id}">Your answer to {reply.username}</label>
				<textarea
					id="answer-{reply.id}"
					rows="1"
					value={text}
					use:autosize
					placeholder="Reply to {reply.username}…"
					oninput={(event) => (edits[reply.id] = event.currentTarget.value)}
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
						<button
							type="button"
							class="btn btn-secondary small"
							disabled={!text.trim() || count > 500}
							onclick={() => {
								if (sandbox.act((store) => (store.saveReply(reply.id, text), 'Saved'))) delete edits[reply.id];
							}}
						>
							{reply.draft === null ? 'Save draft' : 'Save'}
						</button>
						{#if reply.draft !== null}
							<button type="button" class="act" onclick={() => delete edits[reply.id]}>Undo edits</button>
						{/if}
					</div>
				{:else if reply.draft !== null}
					<div class="actions">
						<button
							type="button"
							class="btn btn-primary small"
							onclick={() => sandbox.act((store) => (store.sendReply(reply.id), `Sent to ${reply.username}`))}
						>
							<Icon name="send" size={16} />Send
						</button>
						<button
							type="button"
							class="act discard"
							onclick={() => sandbox.act((store) => (store.discardReply(reply.id), 'Discarded'))}>Discard</button
						>
					</div>
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

<style>
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
		background: var(--primary);
		color: var(--on-primary);
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

	.text {
		margin-top: 2px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 21px;
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
