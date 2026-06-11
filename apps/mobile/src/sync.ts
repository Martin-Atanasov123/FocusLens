/**
 * Usage collection + sync to the FocusLens desktop agent.
 *
 * Reads today's per-app foreground time via UsageStatsManager and POSTs
 * a snapshot to /events. The agent REPLACES the midnight-bucket row on
 * every sync, so repeated syncs never double-count.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  checkForPermission,
  queryAndAggregateUsageStats,
  showUsageAccessSettings,
} from "@brighthustle/react-native-usage-stats-manager";

export interface PairConfig {
  baseUrl: string;
  token: string;
}

export async function loadConfig(): Promise<PairConfig | null> {
  const raw = await AsyncStorage.getItem("fl_config");
  return raw ? JSON.parse(raw) : null;
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

export function openUsageAccessSettings(): void {
  showUsageAccessSettings("com.focuslens.mobile");
}

/** Today's per-app foreground seconds, top 50. */
export async function todayUsageSeconds(): Promise<
  { key: string; label: string; secs: number }[]
> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const stats = await queryAndAggregateUsageStats(midnight.getTime(), Date.now());
  const rows = Object.values(stats ?? {}) as any[];
  return rows
    .filter((s) => !s.isSystem)
    .map((s) => ({
      key: String(s.packageName ?? ""),
      label: String(s.appName || s.packageName || ""),
      secs: Math.floor(Number(s.totalTimeInForeground ?? 0)),
    }))
    .filter((r) => r.key && r.secs > 0)
    .sort((a, b) => b.secs - a.secs)
    .slice(0, 50);
}

/** POST today's snapshot to the agent. Returns true on success. */
export async function syncNow(): Promise<boolean> {
  const cfg = await loadConfig();
  if (!cfg?.baseUrl || !cfg.token) return false;

  const usage = await todayUsageSeconds();
  if (usage.length === 0) return true;

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const bucketTs = Math.floor(midnight.getTime() / 1000);

  const body = {
    source: "android",
    records: usage.map((u) => ({
      kind: "app",
      key: u.key,
      active_secs: u.secs,
      bucket_ts: bucketTs,
    })),
  };

  try {
    const res = await fetch(cfg.baseUrl.replace(/\/+$/, "") + "/events", {
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
