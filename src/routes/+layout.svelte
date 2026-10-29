<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import type { LayoutProps } from './$types';
  let { children }: LayoutProps = $props();
</script>

<svelte:head>
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#0e0e0c" media="(prefers-color-scheme: dark)" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Antre" />
  <meta property="og:title" content="Antre" />
  <meta property="og:description" content="The review queue between your agent and your Threads and LinkedIn." />
  <meta property="og:image" content="{page.url.origin}/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Your agent drafts. You plan the week. Beside it, today's posting schedule in Antre." />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

{@render children()}
