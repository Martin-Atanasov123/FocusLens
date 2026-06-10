<script lang="ts">
  import { formatDuration } from "@focuslens/shared";
  import { deleteLimit, getLimits, upsertLimit, type LimitWithUsage } from "../api";

  let limits: LimitWithUsage[] = $state([]);
  let error = $state("");

  let targetKind = $state<"app" | "domain">("domain");
  let targetKey = $state("");
  let limitMinutes = $state(60);

  export async function refresh() {
    try {
      limits = await getLimits();
      error = "";
    } catch (e) {
      error = String(e);
    }
  }

  async function addLimit(ev: SubmitEvent) {
    ev.preventDefault();
    try {
      await upsertLimit({
        targetKind,
        targetKey: targetKey.trim().toLowerCase(),
        period: "daily",
        limitSecs: Math.round(limitMinutes * 60),
        limitType: "soft",
        enabled: true,
      });
      targetKey = "";
      await refresh();
    } catch (e) {
      error = String(e);
    }
  }

  async function remove(id: number) {
    try {
      await deleteLimit(id);
      await refresh();
    } catch (e) {
      error = String(e);
    }
  }

  function pctOf(l: LimitWithUsage): number {
    return Math.min(100, (l.usedSecsToday / l.limitSecs) * 100);
  }

  function fillColor(l: LimitWithUsage): string {
    const pct = (l.usedSecsToday / l.limitSecs) * 100;
    if (pct >= 100) return "var(--over)";
    if (pct >= 80) return "var(--warn)";
    return "var(--ok)";
  }

  refresh();
</script>

<div class="panel">
  <form class="form-grid" onsubmit={addLimit}>
    <select bind:value={targetKind}>
      <option value="domain">Domain</option>
      <option value="app">App</option>
    </select>
    <input
      bind:value={targetKey}
      required
      placeholder={targetKind === "domain" ? "youtube.com" : "chrome.exe"}
      style="flex: 1; min-width: 180px"
    />
    <input type="number" bind:value={limitMinutes} min="1" max="1440" style="width: 90px" />
    <span class="subtle">min/day</span>
    <button class="primary" type="submit">Add soft limit</button>
  </form>
  {#if error}<div class="error">{error}</div>{/if}
</div>

<h2>Active limits</h2>
{#if limits.length === 0}
  <div class="empty">No limits yet. Reminders fire at 50%, 80% and 100% of a limit.</div>
{:else}
  {#each limits as l (l.id)}
    <div class="panel" style="margin-bottom: 10px">
      <div class="row" style="padding: 0">
        <span class="label" style="flex: 1">{l.targetKey}</span>
        <span class="badge">{l.targetKind}</span>
        <span class="badge">{l.limitType} · {l.period}</span>
        <span class="value" style="flex: 0 0 150px">
          {formatDuration(l.usedSecsToday)} / {formatDuration(l.limitSecs)}
        </span>
        <button class="ghost" onclick={() => remove(l.id)}>Remove</button>
      </div>
      <div class="limit-progress">
        <div class="fill" style="width: {pctOf(l)}%; background: {fillColor(l)}"></div>
      </div>
    </div>
  {/each}
{/if}
