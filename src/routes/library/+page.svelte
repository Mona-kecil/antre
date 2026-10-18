<script lang="ts">
  import { wib } from '#lib/time.ts';
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();
</script>

<svelte:head><title>antre — Content library</title></svelte:head>
<main>
  <header><div><h1>Content library</h1><p>@{data.account.username} · All times in WIB</p></div><nav><a href="/">Queue</a> · <a href="/login">Reconnect Threads</a></nav></header>
  {#if !data.posts.length}<p>No published posts yet. Run sync_now through MCP to import from Threads.</p>{/if}
  <div class="table"><table>
    <thead><tr><th>Date (WIB)</th><th>Post</th><th>Topic</th><th>Angle</th><th>Format</th><th>Views</th><th>Likes</th><th>Replies</th><th>Reposts</th><th>Quotes</th><th>Shares</th><th>Engagement</th></tr></thead>
    <tbody>{#each data.posts as post (post.id)}<tr>
      <td><time datetime={post.date}>{wib(Date.parse(post.date))}</time></td>
      <td class="text">{#if post.permalink}<a href={post.permalink} target="_blank" rel="noreferrer">{post.text || '[media post]'}</a>{:else}{post.text}{/if}</td>
      <td>{post.meta.topic ?? '—'}</td><td>{post.meta.angle ?? '—'}</td><td>{post.meta.format ?? '—'}</td>
      <td>{post.metrics?.views ?? '—'}</td><td>{post.metrics?.likes ?? '—'}</td><td>{post.metrics?.replies ?? '—'}</td><td>{post.metrics?.reposts ?? '—'}</td><td>{post.metrics?.quotes ?? '—'}</td><td>{post.metrics?.shares ?? '—'}</td>
      <td>{post.engagement === null ? '—' : `${(post.engagement * 100).toFixed(2)}%`}</td>
    </tr>{/each}</tbody>
  </table></div>
  <section aria-labelledby="taxonomy-title">
    <h2 id="taxonomy-title">Taxonomy</h2>
    {#each ['topic', 'angle', 'format'] as dimension}
      {@const entries = data.taxonomy.filter((entry) => entry.dimension === dimension)}
      <h3>{dimension[0].toUpperCase() + dimension.slice(1)}</h3>
      {#if entries.length}
        <div class="table"><table>
          <thead><tr><th>Code</th><th>Name</th><th>Description</th></tr></thead>
          <tbody>{#each entries as entry (entry._id)}<tr><td><code>{entry.code}</code></td><td>{entry.name}</td><td>{entry.description ?? '—'}</td></tr>{/each}</tbody>
        </table></div>
      {:else}<p>No {dimension} entries yet.</p>{/if}
    {/each}
  </section>
</main>
<style>
  :global(body) { margin: 0; color: #222; background: #f8f7f4; font: 16px/1.5 system-ui, sans-serif; }
  main { margin: 0 auto; max-width: 1500px; padding: 32px 20px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; }
  h1 { margin: 0; font-size: 28px; } a { color: #215f4b; } header p { color: #666; }
  section { margin-top: 32px; }
  .table { overflow-x: auto; } table { width: 100%; border-collapse: collapse; background: white; }
  th, td { text-align: left; padding: 10px; border: 1px solid #ddd; vertical-align: top; }
  th { font-size: 14px; } time { white-space: nowrap; } .text { min-width: 250px; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
