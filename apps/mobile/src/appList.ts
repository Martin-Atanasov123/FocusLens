/**
 * Unified app picker source: every installed app, annotated with today's
 * foreground seconds. Apps used today sort first (by time desc), the rest
 * follow alphabetically — so the picker is complete but the apps you actually
 * use are on top. Used by both the Limits and Rules app selectors.
 */
import { getInstalledApps, usageSince } from "./blocking/FocusBlocker";

export type PickableApp = { key: string; label: string; secs: number };

function midnightMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export async function loadAllApps(): Promise<PickableApp[]> {
  const [installed, usage] = await Promise.all([
    getInstalledApps(),
    Promise.resolve().then(() => {
      try {
        return usageSince(midnightMs());
      } catch {
        return [] as { packageName: string; appName: string; secs: number }[];
      }
    }),
  ]);

  const secsByPkg = new Map<string, number>();
  const labelByPkg = new Map<string, string>();
  for (const u of usage) {
    secsByPkg.set(u.packageName, u.secs);
    labelByPkg.set(u.packageName, u.appName);
  }

  const rows: PickableApp[] = installed.map((a) => ({
    key: a.packageName,
    // Prefer the usage-resolved label when present (matches Digital Wellbeing).
    label: labelByPkg.get(a.packageName) || a.appName,
    secs: secsByPkg.get(a.packageName) ?? 0,
  }));

  // Include used apps that somehow aren't in the launcher list (rare).
  for (const u of usage) {
    if (!rows.some((r) => r.key === u.packageName)) {
      rows.push({ key: u.packageName, label: u.appName, secs: u.secs });
    }
  }

  rows.sort((a, b) => b.secs - a.secs || a.label.localeCompare(b.label));
  return rows;
}
