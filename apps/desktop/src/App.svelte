<script lang="ts">
  import { onMount } from "svelte";
  import { formatDuration } from "@focuslens/shared";
  import { getDaySummary, type DaySummary } from "./lib/api";
  import UsageList from "./lib/components/UsageList.svelte";
  import LimitsPanel from "./lib/components/LimitsPanel.svelte";
  import SettingsPanel from "./lib/components/SettingsPanel.svelte";

  type Tab = "today" | "limits" | "settings";
  let tab = $state<Tab>("today");
  let summary = $state<DaySummary | null>(null);
  let error = $state("");

  async function refresh() {
    try {
      summary = await getDaySummary();
      error = "";
    } catch (e) {
      error = String(e);
    }
  }

  onMount(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  });
</script>

<div class="topbar">
  <h1>FocusLens</h1>
  <nav class="tabs">
    <button class:active={tab === "today"} onclick={() => (tab = "today")}>Today</button>
    <button class:active={tab === "limits"} onclick={() => (tab = "limits")}>Limits</button>
    <button class:active={tab === "settings"} onclick={() => (tab = "settings")}>Settings</button>
  </nav>
</div>

{#if tab === "today"}
  {#if error}
    <div class="error">{error}</div>
  {:else if summary}
    <div class="panel">
      <div class="subtle">{summary.date} · active screen time</div>
      <div class="total">{formatDuration(summary.totalActiveSecs)}</div>
    </div>

    <h2>Top websites <span class="badge">from browser extension</span></h2>
    <div class="panel">
      <UsageList
        entries={summary.domains}
        emptyText="No browser activity yet. Install and pair the FocusLens extension to see per-site time."
      />
    </div>

    <h2>Top applications <span class="badge">from desktop agent</span></h2>
    <div class="panel">
      <UsageList entries={summary.apps} emptyText="No activity recorded yet — give it a minute." />
    </div>
  {:else}
    <div class="empty">Loading…</div>
  {/if}
{:else if tab === "limits"}
  <LimitsPanel />
{:else}
  <SettingsPanel />
{/if}
