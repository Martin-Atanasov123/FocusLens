// Popup: pairing token entry + today's top sites pulled from the agent.

import {
  AGENT_BASE_URL,
  TOKEN_HEADER,
  formatDuration,
  type DaySummary,
} from "@focuslens/shared";

const statusEl = document.getElementById("status") as HTMLDivElement;
const summaryEl = document.getElementById("summary") as HTMLDivElement;
const tokenEl = document.getElementById("token") as HTMLInputElement;
const saveEl = document.getElementById("save") as HTMLButtonElement;

function setStatus(text: string, kind: "ok" | "bad" | "plain"): void {
  statusEl.textContent = text;
  statusEl.className = `status${kind === "plain" ? "" : ` ${kind}`}`;
}

function renderSummary(summary: DaySummary): void {
  summaryEl.replaceChildren();
  const top = summary.domains.slice(0, 8);
  if (top.length === 0) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "No browsing tracked yet today.";
    summaryEl.append(hint);
    return;
  }
  for (const entry of top) {
    const row = document.createElement("div");
    row.className = "row";
    const domain = document.createElement("span");
    domain.className = "domain";
    domain.textContent = entry.label;
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = formatDuration(entry.activeSecs);
    row.append(domain, time);
    summaryEl.append(row);
  }
}

async function refresh(): Promise<void> {
  const data = await chrome.storage.local.get("pairingToken");
  const token = (data["pairingToken"] as string | undefined) ?? "";
  if (!token) {
    setStatus("Not paired — paste the token from the desktop app's Settings tab.", "bad");
    return;
  }
  tokenEl.placeholder = "Token saved — paste to replace";
  try {
    const resp = await fetch(`${AGENT_BASE_URL}/summary/today`, {
      headers: { [TOKEN_HEADER]: token },
    });
    if (resp.status === 401) {
      setStatus("Token rejected by the desktop app — copy it again from Settings.", "bad");
      return;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    renderSummary((await resp.json()) as DaySummary);
    setStatus("Connected to FocusLens desktop", "ok");
  } catch {
    setStatus("Desktop app not running — activity is buffered locally.", "bad");
  }
}

saveEl.addEventListener("click", () => {
  void (async () => {
    const token = tokenEl.value.trim();
    if (!token) return;
    await chrome.storage.local.set({ pairingToken: token });
    tokenEl.value = "";
    await refresh();
  })();
});

void refresh();
