<script lang="ts">
  import { wib } from '#lib/time.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  let edits = $state<Record<string, string>>({});
</script>

<svelte:head><title>antre — Replies</title></svelte:head>
<main>
  <header><div><h1>Replies</h1><p>@{data.account.username} · All times in WIB</p></div><nav><a href="/">Queue</a> · <a href="/library">Library</a> · <a href="/replies">Refresh</a></nav></header>
  <p>Review each answer before sending. Save edits first; Send publishes the saved draft.</p>
  <p class="muted">Last sync: {data.syncedAt ? wib(Date.parse(data.syncedAt)) : 'Never'}. Run sync_now through MCP to fetch replies.</p>
  {#if data.account.needsReconnect}<aside>Threads needs reconnecting. <a href="/login">Reconnect account</a></aside>{/if}
  {#if form?.error}<p role="alert" class="error">{form.error}</p>{/if}
  {#if form?.message}<p role="status">{form.message}</p>{/if}
  {#if !data.replies.length}<p>No drafts or unanswered replies.</p>{/if}
  {#each data.replies as reply (reply.replyId)}
    {@const text = edits[reply.replyId] ?? reply.draft ?? ''}
    <article>
      <div class="heading"><strong>@{reply.username}</strong><time datetime={reply.at}>{wib(Date.parse(reply.at))}</time></div>
      {#if reply.hidden}<p class="muted">Hidden on Threads</p>{/if}
      <p class="text">{reply.text}</p>
      {#if reply.permalink}<a href={reply.permalink} target="_blank" rel="noreferrer">View reply on Threads ↗</a>{/if}
      <details><summary>Parent context</summary><p class="muted">Root post</p><p class="text">{reply.postText}</p><p class="muted">Replying to</p><p class="text">{reply.parentText ?? 'Parent text unavailable'}</p></details>
      <form method="POST" action="?/reply">
        <input type="hidden" name="replyId" value={reply.replyId} />
        <label for={`draft-${reply.replyId}`}>Draft answer</label>
        <textarea id={`draft-${reply.replyId}`} name="text" value={text} oninput={(event) => edits[reply.replyId] = event.currentTarget.value} rows="4" required></textarea>
        <div class="controls"><span class:error={[...text].length > 500}>{[...text].length} / 500</span><button name="operation" value="save" disabled={!text.trim() || [...text].length > 500}>{reply.draft === null ? 'Save draft' : 'Save'}</button></div>
      </form>
      {#if reply.draft !== null}
        <form method="POST" action="?/reply" class="actions">
          <input type="hidden" name="replyId" value={reply.replyId} />
          <input type="hidden" name="text" value={reply.draft} />
          <button name="operation" value="send" disabled={text !== reply.draft}>Send</button>
          <button name="operation" value="discard">Discard</button>
          {#if text !== reply.draft}<span class="muted">Save your edits before sending.</span>{/if}
        </form>
      {:else if reply.sending !== null}
        <form method="POST" action="?/reply" class="actions">
          <input type="hidden" name="replyId" value={reply.replyId} />
          <span class="muted">A send started for “{reply.sending}”. If it hasn't appeared on Threads after 15 minutes, discard to unlock.</span>
          <button name="operation" value="discard">Discard</button>
        </form>
      {/if}
    </article>
  {/each}
</main>

<style>
  :global(body) { margin: 0; color: #222; background: #f8f7f4; font: 16px/1.5 system-ui, sans-serif; }
  :global(*) { box-sizing: border-box; }
  main { max-width: 740px; margin: 0 auto; padding: 32px 20px 80px; }
  header, .heading, .controls { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  h1 { margin: 0; font-size: 28px; } header p, .muted { color: #666; }
  a { color: #215f4b; } article { padding: 18px; background: white; border: 1px solid #ddd; border-radius: 8px; margin: 16px 0; }
  .heading, .controls { font-size: 13px; } .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  details { margin: 16px 0; } label { display: block; font-size: 14px; }
  textarea { display: block; width: 100%; resize: vertical; margin: 8px 0; padding: 10px; border: 1px solid #bbb; border-radius: 4px; font: inherit; }
  button { font: inherit; padding: 7px 10px; border: 1px solid #bbb; border-radius: 5px; background: white; cursor: pointer; }
  button:hover:enabled { background: #efeee9; } button:disabled { opacity: .45; cursor: default; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
  .error { color: #a12222; } aside { padding: 16px; background: #fff1d5; border-radius: 6px; }
  @media (max-width: 480px) { header, .heading { flex-wrap: wrap; } }
</style>
