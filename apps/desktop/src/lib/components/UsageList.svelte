<script lang="ts">
  import { formatDuration } from "@focuslens/shared";
  import type { EntrySummary } from "../api";

  let { entries, emptyText }: { entries: EntrySummary[]; emptyText: string } = $props();

  let max = $derived(entries.length > 0 ? entries[0].activeSecs : 1);
</script>

{#if entries.length === 0}
  <div class="empty">{emptyText}</div>
{:else}
  {#each entries.slice(0, 15) as entry (entry.key)}
    <div class="row">
      <span class="label" title={entry.key}>{entry.label}</span>
      <span class="badge">{entry.source === "extension" ? "browser" : "desktop"}</span>
      <div class="bar-track">
        <div class="bar" style="width: {Math.max(2, (entry.activeSecs / max) * 100)}%"></div>
      </div>
      <span class="value">{formatDuration(entry.activeSecs)}</span>
    </div>
  {/each}
{/if}
