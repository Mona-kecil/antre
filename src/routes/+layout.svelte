<script lang="ts">
  import '../app.css';
  import favicon from '#lib/assets/favicon.svg';
  import type { LayoutProps } from './$types';
  let { children }: LayoutProps = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#101010" media="(prefers-color-scheme: dark)" />
</svelte:head>

{@render children()}
