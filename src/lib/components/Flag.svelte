<script lang="ts">
	import Icon, { type IconName } from './Icon.svelte';

	let {
		icon,
		tone = 'muted',
		text
	}: { icon: IconName; tone?: 'muted' | 'amber' | 'red' | 'green' | 'indigo'; text: string } =
		$props();
</script>

<span class="flag {tone}"><Icon name={icon} size={12} stroke={2} />{text}</span>

<style>
	.flag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: 6px;
		font-size: 12px;
		line-height: 16px;
		font-weight: 500;
		white-space: nowrap;
	}

	.muted {
		color: var(--fg-2);
	}
	.amber {
		color: var(--amber);
	}
	.red {
		color: var(--red);
	}
	.green {
		color: var(--green);
	}
	.indigo {
		color: var(--indigo);
	}
</style>
