<script lang="ts">
	import Composer from './Composer.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.edit ? 'Edit draft' : 'New thread'} · antre</title></svelte:head>

{#key data.edit?.id}
	<Composer edit={data.edit} nextSlot={data.nextSlot} username={data.account?.username ?? 'you'} connected={Boolean(data.account && !data.account.needsReconnect)} />
{/key}
