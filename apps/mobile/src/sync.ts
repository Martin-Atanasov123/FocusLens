/**
 * Usage collection + sync to the FocusLens desktop agent.
 *
 * Reads today's per-app foreground time via UsageStatsManager and POSTs
 * a snapshot to /events. The agent REPLACES the midnight-bucket row on
 * every sync, so repeated syncs never double-count.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import * as Device from "expo-device";
import * as IntentLauncher from "expo-intent-launcher";
import {
  checkForPermission,
  queryEvents,
  showUsageAccessSettings,
} from "@brighthustle/react-native-usage-stats-manager";

export interface PairConfig {
  baseUrl: string;
  /** Off-network fallback (Cloudflare tunnel). Refreshed from the desktop
   *  whenever we're on the same Wi-Fi — trycloudflare URLs change on every
   *  desktop restart, so we never hard-code it. */
  remoteUrl?: string;
  token: string;
}

export async function loadConfig(): Promise<PairConfig | null> {
  const raw = await AsyncStorage.getItem("fl_config");
  return raw ? JSON.parse(raw) : null;
}

/** Pick a reachable base URL: LAN first (fast, no token on public paths),
 *  then the tunnel fallback. Returns null if neither answers. */
export async function resolveBaseUrl(cfg: PairConfig): Promise<string | null> {
  if (await pingDesktop(cfg.baseUrl)) return cfg.baseUrl;
  if (cfg.remoteUrl && (await pingDesktop(cfg.remoteUrl))) return cfg.remoteUrl;
  return null;
}

/** When reachable over LAN, pull the current tunnel URL and remember it as the
 *  off-network fallback. No-op (keeps the old remoteUrl) when off-LAN. */
export async function refreshRemoteUrl(cfg: PairConfig): Promise<PairConfig> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(
      cfg.baseUrl.replace(/\/+$/, "") + "/api/network-info",
      { signal: ctrl.signal }
    );
    if (!res.ok) return cfg;
    const d = await res.json();
    const tunnelUrl = d?.tunnelUrl ? String(d.tunnelUrl) : "";
    if (tunnelUrl && tunnelUrl !== cfg.remoteUrl) {
      const updated = { ...cfg, remoteUrl: tunnelUrl };
      await saveConfig(updated);
      return updated;
    }
  } catch {
    // not on LAN / desktop offline — keep whatever remoteUrl we already have
  } finally {
    clearTimeout(timer);
  }
  return cfg;
}

/** Health-check the desktop agent. /ping is public (no token needed). */
export async function pingDesktop(baseUrl: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(baseUrl.replace(/\/+$/, "") + "/ping", {
      method: "GET",
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function saveConfig(cfg: PairConfig): Promise<void> {
  await AsyncStorage.setItem("fl_config", JSON.stringify(cfg));
}

export async function hasUsagePermission(): Promise<boolean> {
  try {
    return await checkForPermission();
  } catch {
    return false;
  }
}

export async function openUsageAccessSettings(): Promise<void> {
  // PACKAGE_USAGE_STATS is a "special access" permission — Android has no
  // runtime popup for it, so the best we can do is land the user directly
  // on the Usage Access settings screen. IntentLauncher is the most
  // reliable way to fire ACTION_USAGE_ACCESS_SETTINGS on MIUI/HyperOS.
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.USAGE_ACCESS_SETTINGS"
    );
    return;
  } catch {
    // fall through to the library helper / generic app settings
  }
  try {
    showUsageAccessSettings("com.focuslens.mobile");
    return;
  } catch {
    // last resort: this app's own settings page
  }
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.APPLICATION_DETAILS_SETTINGS",
      { data: "package:com.focuslens.mobile" }
    );
  } catch {
    // nothing else to try
  }
}

/** Stable per-device identity so two phones never merge into one total.
 *  ANDROID_ID survives reinstalls (scoped to the app signing key + device),
 *  so the same phone keeps the same id across re-pairing. Falls back to a
 *  persisted random id if the platform value is unavailable. */
export async function deviceInfo(): Promise<{ deviceId: string; deviceName: string }> {
  let id = "";
  try {
    id = Application.getAndroidId() || "";
  } catch {
    /* platform id unavailable — fall back below */
  }
  if (!id) {
    id = (await AsyncStorage.getItem("fl_device_id")) || "";
    if (!id) {
      id = "dev-" + Math.random().toString(36).slice(2, 12);
      await AsyncStorage.setItem("fl_device_id", id);
    }
  }
  const name = Device.deviceName || Device.modelName || "Phone";
  return { deviceId: id, deviceName: String(name) };
}

/** Today's per-app foreground seconds, top 50.
 *
 * Uses event-based sessions (queryEvents pairs FOREGROUND→BACKGROUND events,
 * the same way Digital Wellbeing measures screen time). The earlier
 * queryAndAggregateUsageStats over-reported ~2–3x because Android's
 * getTotalTimeInForeground sums overlapping daily buckets and includes the
 * pre-midnight portion of the bucket that straddles midnight. usageTime is in
 * milliseconds; system apps are already filtered out natively. */
export async function todayUsageSeconds(): Promise<
  { key: string; label: string; secs: number }[]
> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const events = await queryEvents(midnight.getTime(), Date.now());
  const rows = Object.values(events ?? {}) as any[];
  return rows
    .filter((s) => !s.isSystem)
    .map((s) => ({
      key: String(s.packageName ?? ""),
      label: String(s.name || s.packageName || ""),
      secs: Math.floor(Number(s.usageTime ?? 0) / 1000), // ms → s
    }))
    .filter((r) => r.key && r.secs > 0)
    .sort((a, b) => b.secs - a.secs)
    .slice(0, 50);
}

/** POST today's snapshot to the agent. Returns true on success. */
export async function syncNow(): Promise<boolean> {
  const cfg = await loadConfig();
  if (!cfg?.baseUrl || !cfg.token) return false;

  const base = await resolveBaseUrl(cfg);
  if (!base) return false;

  const usage = await todayUsageSeconds();
  if (usage.length === 0) return true;

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const bucketTs = Math.floor(midnight.getTime() / 1000);

  const { deviceId, deviceName } = await deviceInfo();
  const body = {
    source: "android",
    deviceId,
    deviceName,
    records: usage.map((u) => ({
      kind: "app",
      key: u.key,
      active_secs: u.secs,
      bucket_ts: bucketTs,
    })),
  };

  try {
    const res = await fetch(base.replace(/\/+$/, "") + "/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-focuslens-token": cfg.token,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await AsyncStorage.setItem("fl_last_sync", String(Date.now()));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
