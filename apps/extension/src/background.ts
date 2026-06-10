// MV3 service worker: wires chrome events to the TabTracker and flushes
// minute buckets to the desktop agent once per minute via chrome.alarms.
// The worker may be suspended between events; the alarm wakes it, and the
// offline buffer in chrome.storage.local survives suspension and restarts.

import { domainFromUrl } from "@focuslens/shared";
import { TabTracker } from "./tracker";
import { chromeQueueStorage, Transport } from "./transport";

const FLUSH_ALARM = "focuslens-flush";
const IDLE_DETECTION_SECS = 60;

const tracker = new TabTracker();
const transport = new Transport(chromeQueueStorage());

async function getToken(): Promise<string | null> {
  const data = await chrome.storage.local.get("pairingToken");
  return (data["pairingToken"] as string | undefined) ?? null;
}

/** Resync the tracker with reality (worker start, after suspension). */
async function syncFromCurrentState(): Promise<void> {
  const now = Date.now();
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tracker.setDomain(domainFromUrl(tab?.url), now);
    const win = tab ? await chrome.windows.get(tab.windowId) : null;
    tracker.setFocused(win?.focused ?? false, now);
  } catch {
    tracker.setDomain(null, now);
  }
}

chrome.runtime.onInstalled.addListener(() => void syncFromCurrentState());
chrome.runtime.onStartup.addListener(() => void syncFromCurrentState());

chrome.tabs.onActivated.addListener((info) => {
  void chrome.tabs.get(info.tabId).then(
    (tab) => tracker.setDomain(domainFromUrl(tab.url), Date.now()),
    () => tracker.setDomain(null, Date.now()),
  );
});

chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.url && tab.active) {
    tracker.setDomain(domainFromUrl(change.url), Date.now());
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  tracker.setFocused(windowId !== chrome.windows.WINDOW_ID_NONE, Date.now());
});

chrome.idle.setDetectionInterval(IDLE_DETECTION_SECS);
chrome.idle.onStateChanged.addListener((state) => {
  tracker.setIdle(state !== "active", Date.now());
});

chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== FLUSH_ALARM) return;
  void (async () => {
    await transport.enqueue(tracker.flush(Date.now()));
    const token = await getToken();
    if (token) {
      const result = await transport.deliver(token);
      if (!result.ok) {
        // Agent offline or unpaired — buffered locally, retried next minute.
        console.debug(`FocusLens: agent unreachable, ${result.queued} events buffered`);
      }
    }
  })();
});

void syncFromCurrentState();
