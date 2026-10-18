<script lang="ts">
  import { enhance } from '$app/forms';
  import { wib } from '#lib/time.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  let parts = $state<{ text: string; imageId?: string }[]>([{ text: '' }]);
  let editId = $state('');
  let loadedEdit = $state<string | null>(null);
  let pending = $state(0);
  let uploadError = $state('');
  let busy = $state(false);
  let at = $state('');
  const invalid = $derived(parts.some((part) => !part.text.trim() || [...part.text].length > 500));

  $effect(() => {
    const id = data.edit?._id ?? '';
    if (id !== loadedEdit) {
      loadedEdit = id;
      editId = id;
      parts = data.edit?.parts.map((part) => ({ ...part })) ?? [{ text: '' }];
    }
  });

  async function upload(event: Event, part: (typeof parts)[number]) {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
    pending++;
    uploadError = '';
    try {
      const file = input.files[0];
      const response = await fetch('/upload', { method: 'POST', headers: { 'content-type': file.type }, body: file });
      if (!response.ok) throw new Error('Image upload failed. Use JPEG, PNG, or WebP up to 10 MB.');
      const result = await response.json();
      part.imageId = result.storageId;
    } catch (error) { uploadError = error instanceof Error ? error.message : 'Image upload failed'; }
    finally { pending--; input.value = ''; }
  }
</script>

<svelte:head><title>antre — Threads queue</title><meta name="description" content="Draft and schedule your Threads posts." /></svelte:head>

<main>
  <header><div><h1>antre<span> / Threads queue</span></h1><p>@{data.account.username} · All times in WIB</p></div><nav><a href="/library">Library</a> · <a href="/">Refresh</a> · <a href="/login">Reconnect Threads</a></nav></header>
  {#if data.account.needsReconnect}<aside>Threads needs reconnecting. <a href="/login">Reconnect account</a></aside>{/if}
  {#if form?.error}<p role="alert" class="error">{form.error}</p>{/if}
  {#if form?.message}<p role="status">{form.message}</p>{/if}
  <section aria-labelledby="compose-title">
    <h2 id="compose-title">{editId ? 'Edit draft' : 'Compose'}</h2>
    <form method="POST" action="?/compose" use:enhance={() => {
      busy = true;
      return async ({ result, update }) => {
        await update({ reset: false });
        if (result.type === 'success' && !editId) { parts = [{ text: '' }]; at = ''; }
        if (result.type === 'failure' && typeof result.data?.draftId === 'string') editId = result.data.draftId;
        busy = false;
      };
    }}>
      <input type="hidden" name="id" value={editId} />
      <input type="hidden" name="parts" value={JSON.stringify(parts)} />
      <fieldset disabled={busy}>
        {#each parts as part, index (part)}
          <div class="part">
            <label for={`part-${index}`}>Part {index + 1}</label>
            <textarea id={`part-${index}`} bind:value={part.text} rows="4" placeholder="What do you want to share?" required></textarea>
            <div class="part-controls"><span class:error={[...part.text].length > 500}>{[...part.text].length} / 500</span>
              {#if parts.length > 1}<button type="button" onclick={() => parts.splice(index, 1)} disabled={pending > 0}>Remove part</button>{/if}
            </div>
            <label class="upload">{part.imageId ? 'Replace image' : 'Add image'}<input type="file" accept="image/jpeg,image/png,image/webp" onchange={(event) => upload(event, part)} disabled={pending > 0} /></label>
            {#if part.imageId}<span>Image attached <button type="button" onclick={() => part.imageId = undefined}>Remove image</button></span>{/if}
          </div>
        {/each}
        <button type="button" onclick={() => parts.push({ text: '' })}>+ Add part</button>
        {#if pending}<p role="status">Uploading image…</p>{/if}
        {#if uploadError}<p role="alert" class="error">{uploadError}</p>{/if}
        <div class="actions">
          <button name="mode" value="draft" disabled={invalid || pending > 0}>Save draft</button>
          <button name="mode" value="queue" disabled={invalid || pending > 0}>Add to queue</button>
          <button name="mode" value="now" disabled={invalid || pending > 0}>Publish now</button>
        </div>
        <div class="schedule"><label>Exact time (WIB)<input type="datetime-local" name="at" bind:value={at} /></label>
          <button name="mode" value="schedule" disabled={invalid || !at || pending > 0}>Schedule</button></div>
        {#if editId}<a href="/">Cancel edit</a>{/if}
      </fieldset>
    </form>
  </section>
  <section aria-labelledby="queue-title">
    <h2 id="queue-title">Queue</h2><p class="muted">Next free slots: every 30 minutes, 06:00–12:00 WIB.</p>
    {#if data.groups.length === 0}<p>No posts yet. Write your first draft above.</p>{/if}
    {#each data.groups as group}
      <h3>{group.day}</h3>
      {#each group.posts as post}
        <article>
          <div class="post-heading"><strong>{post.status.kind}</strong>{#if post.status.kind !== 'draft'}<time datetime={new Date(post.status.at).toISOString()}>{wib(post.status.at)}</time>{/if}</div>
          {#each post.parts as part, index}<p class="post-text">{#if post.parts.length > 1}<span class="muted">{index + 1}. </span>{/if}{part.text}{#if part.imageId}<span class="muted"> [image]</span>{/if}</p>{/each}
          {#if post.status.kind === 'published'}<a href={post.status.permalink} target="_blank" rel="noreferrer">View on Threads ↗</a>{/if}
          {#if post.status.kind === 'failed'}<p class="error">{post.status.error}</p>{/if}
          <form method="POST" action="?/post" use:enhance>
            <input type="hidden" name="id" value={post._id} />
            {#if post.status.kind === 'draft'}<a href={`/?edit=${post._id}#compose-title`}>Edit</a><button name="operation" value="queue">Queue</button><button name="operation" value="delete">Delete</button>{/if}
            {#if post.status.kind === 'queued'}<button name="operation" value="unqueue">Unqueue</button>{/if}
            {#if post.status.kind === 'failed'}<button name="operation" value="retry">Retry</button>{/if}
          </form>
        </article>
      {/each}
    {/each}
  </section>
</main>

<style>
  :global(body) { margin: 0; color: #222; background: #f8f7f4; font: 16px/1.5 system-ui, sans-serif; }
  :global(*) { box-sizing: border-box; }
  main { max-width: 740px; margin: 0 auto; padding: 32px 20px 80px; }
  header, .part-controls, .post-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  h1 { margin: 0; font-size: 28px; letter-spacing: -1px; } h1 span { font-size: 16px; font-weight: 400; letter-spacing: 0; color: #666; }
  header p, .muted { color: #666; } h2 { font-size: 21px; } h3 { margin-top: 28px; font-size: 16px; }
  section { margin-top: 32px; } fieldset { border: 0; padding: 0; min-width: 0; }
  .part, article { padding: 18px; background: white; border: 1px solid #ddd; border-radius: 8px; margin: 12px 0; }
  label { display: block; font-size: 14px; } textarea { display: block; width: 100%; resize: vertical; margin: 8px 0; padding: 10px; border: 1px solid #bbb; border-radius: 4px; font: inherit; }
  button, input[type='datetime-local'] { font: inherit; padding: 7px 10px; border: 1px solid #bbb; border-radius: 5px; background: white; }
  button { cursor: pointer; } button:hover:enabled { background: #efeee9; } button:disabled { opacity: .45; cursor: default; }
  a { color: #215f4b; } .actions, .schedule { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; align-items: end; }
  .upload { margin: 10px 0; } input[type='file'] { display: block; max-width: 100%; margin-top: 5px; }
  .part-controls { font-size: 13px; } article form { display: flex; gap: 10px; align-items: center; } .post-heading { font-size: 13px; }
  .post-text { white-space: pre-wrap; overflow-wrap: anywhere; } .error { color: #a12222; } aside { padding: 16px; background: #fff1d5; margin-top: 20px; border-radius: 6px; }
  @media (max-width: 480px) { header, .post-heading { flex-wrap: wrap; } h1 span { display: block; } }
</style>
