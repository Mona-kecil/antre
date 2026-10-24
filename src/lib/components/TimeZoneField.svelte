<script lang="ts">
  let { value, id = 'time-zone', label = 'Time zone' }: { value: string; id?: string; label?: string } = $props();
  const zones = Intl.supportedValuesOf('timeZone');
</script>

<label for={id}>{label}</label>
<input class="field" {id} name="timeZone" {value} list="{id}-choices" required autocomplete="off" />
<datalist id="{id}-choices">
  {#each zones as zone}<option value={zone}></option>{/each}
</datalist>

<style>
  label { display: block; margin: 12px 0 6px; font-size: 13px; font-weight: 600; }
  input { width: 100%; }
</style>
