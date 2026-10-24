<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import TimeZoneField from '#lib/components/TimeZoneField.svelte';
  import TopBar from '#lib/components/TopBar.svelte';
  import type { PageProps } from './$types';
  let { data, form }: PageProps = $props();
  let timeZone = $state(untrack(() => data.workspace.timeZone));
  let busy = $state(false);
  onMount(() => { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; });
</script>

<svelte:head><title>Set up your workspace · antre</title></svelte:head>
<TopBar title="Your workspace" />
<main>
  <h2>Choose where your posts begin.</h2>
  <p>Connect a posting profile, or write your first draft. Each channel keeps its own queue.</p>
  <form method="POST" action="?/start" use:enhance={() => {
    busy = true;
    return async ({ update }) => { busy = false; await update({ reset: false }); };
  }}>
    <TimeZoneField value={timeZone} label="Confirm your time zone" />
    <p class="hint">Posting windows use this zone. You can set a different zone for each channel in Settings.</p>
    {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
    <fieldset disabled={busy}>
      <legend>Start with a profile</legend>
      <button class="btn btn-primary btn-block" name="next" value="threads">{data.threads ? 'Reconnect' : 'Connect'} Threads</button>
      <button class="btn btn-secondary btn-block" name="next" value="linkedin">{data.linkedin ? 'Reconnect' : 'Connect'} LinkedIn</button>
    </fieldset>
    <fieldset disabled={busy}>
      <legend>Write a draft first</legend>
      <button class="btn btn-secondary btn-block" name="next" value="draft">Write a Threads draft</button>
      <button class="btn btn-secondary btn-block" name="next" value="linkedinDraft">Write a LinkedIn draft</button>
    </fieldset>
    <p class="hint">Drafts stay in Antre until you choose Queue or Publish. A posting profile is needed to publish.</p>
  </form>
</main>

<style>
  main { padding: 24px 16px; }
  h2 { font-size: 20px; line-height: 1.3; letter-spacing: -0.02em; }
  main > p { margin: 8px 0 24px; color: var(--fg-2); }
  .hint { margin-top: 8px; color: var(--fg-2); font-size: 13px; line-height: 1.5; }
  fieldset { display: grid; gap: 12px; margin: 24px 0 0; padding: 0; border: 0; }
  legend { padding: 0 0 12px; font-size: 15px; font-weight: 600; }
  .error { margin-top: 12px; color: var(--red); }
</style>
