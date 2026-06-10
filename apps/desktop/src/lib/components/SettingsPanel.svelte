<script lang="ts">
  import { getPairingToken, getTrackingPaused, setTrackingPaused } from "../api";

  let token = $state("…");
  let paused = $state(false);
  let copied = $state(false);

  async function load() {
    try {
      token = await getPairingToken();
      paused = await getTrackingPaused();
    } catch (e) {
      token = `error: ${e}`;
    }
  }

  async function togglePaused() {
    paused = !paused;
    await setTrackingPaused(paused);
  }

  async function copyToken() {
    await navigator.clipboard.writeText(token);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  load();
</script>

<div class="panel">
  <h2 style="margin-top: 0">Browser extension pairing</h2>
  <p class="subtle">
    Paste this token into the FocusLens extension popup to let it deliver per-tab activity to
    this app. Data flows only over 127.0.0.1 and contains hostnames only — never full URLs.
  </p>
  <div class="row" style="padding: 0">
    <code class="token">{token}</code>
    <button class="primary" onclick={copyToken}>{copied ? "Copied!" : "Copy"}</button>
  </div>
</div>

<div class="panel" style="margin-top: 14px">
  <h2 style="margin-top: 0">Tracking</h2>
  <div class="row" style="padding: 0">
    <span style="flex: 1">
      Tracking is <strong>{paused ? "paused" : "running"}</strong>
      <span class="subtle">(also available from the tray menu)</span>
    </span>
    <button class="primary" onclick={togglePaused}>{paused ? "Resume" : "Pause"}</button>
  </div>
</div>

<div class="panel" style="margin-top: 14px">
  <h2 style="margin-top: 0">Privacy</h2>
  <p class="subtle" style="margin: 0">
    All data stays in a local SQLite database, retained for 90 days (rolling). FocusLens makes
    no network connections — its only listener is the local extension endpoint.
  </p>
</div>
