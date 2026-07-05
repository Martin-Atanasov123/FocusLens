/**
 * High-level wrapper around the native `focus-blocker` Expo module.
 *
 * The native side runs a foreground service that watches the current foreground
 * app and shows a "stay focused" screen over any app on the blocklist until the
 * session ends. Drawing-over-other-apps permission is required (it also lets the
 * background service launch the block screen on Android 10+).
 */
import { FocusBlockerModule } from "../../modules/focus-blocker";

/** Can we draw over other apps? Required for blocking to work. */
export function canDrawOverlays(): boolean {
  try {
    return FocusBlockerModule.canDrawOverlays();
  } catch {
    return false;
  }
}

/** Open the system "Display over other apps" screen for this app. */
export function requestOverlayPermission(): void {
  try {
    FocusBlockerModule.requestOverlayPermission();
  } catch {
    /* native module unavailable in Expo Go / web — no-op */
  }
}

/** Is a focus session currently enforcing blocks? */
export function isBlocking(): boolean {
  try {
    return FocusBlockerModule.isRunning();
  } catch {
    return false;
  }
}

/** Start a focus session: block `packageNames` for `durationMinutes`. */
export function startFocusSession(packageNames: string[], durationMinutes: number): void {
  const until = Date.now() + Math.max(1, durationMinutes) * 60_000;
  FocusBlockerModule.startBlocking(packageNames, until);
}

/** End the current focus session immediately. */
export function stopFocusSession(): void {
  try {
    FocusBlockerModule.stopBlocking();
  } catch {
    /* no-op */
  }
}

/** Accurate per-app foreground seconds since `startEpochMs` (event-paired,
 *  Digital-Wellbeing-style). Throws if the native module is unavailable. */
export function usageSince(
  startEpochMs: number
): { packageName: string; appName: string; secs: number }[] {
  return FocusBlockerModule.usageSince(startEpochMs);
}

// ---- Daily limits ----------------------------------------------------------

export interface AppLimitInfo {
  packageName: string;
  dailyLimitSecs: number;
  usedSecs: number;
  jokerUsedToday: boolean;
}

/** Set (or update) a daily limit for a package. Starts the service if needed. */
export function setLimit(packageName: string, dailyLimitSecs: number): void {
  try {
    FocusBlockerModule.setLimit(packageName, dailyLimitSecs);
  } catch {
    /* no-op on web/simulator */
  }
}

/** Remove a daily limit. Stops the service if no limits remain. */
export function removeLimit(packageName: string): void {
  try {
    FocusBlockerModule.removeLimit(packageName);
  } catch {
    /* no-op */
  }
}

/** Returns all configured limits with today's usage from native SharedPreferences. */
export function getLimits(): AppLimitInfo[] {
  try {
    return FocusBlockerModule.getLimits() as AppLimitInfo[];
  } catch {
    return [];
  }
}

/** Lifetime count of distinct blocking events. Drives the "aha moment" paywall. */
export function getBlockEventCount(): number {
  try {
    return FocusBlockerModule.getBlockEventCount();
  } catch {
    return 0;
  }
}

// ---- Scheduled rules ---------------------------------------------------------

export type ScheduleRuleType = "schedule" | "openLimit";

export interface ScheduleRule {
  id: string;
  /** User-visible name, e.g. "Work Time". */
  name: string;
  /** "schedule" (time window) or "openLimit" (opens/day cap). Defaults to "schedule". */
  type?: ScheduleRuleType;
  packageNames: string[];
  /** ISO day-of-week: 1=Monday .. 7=Sunday. */
  daysOfWeek: number[];
  /** "schedule" only: minutes since local midnight. Overnight (start > end) allowed. */
  startMinute?: number;
  endMinute?: number;
  /** "openLimit" only: max foreground opens per day, and seconds allowed per open. */
  maxOpens?: number;
  perOpenSeconds?: number;
  /** No joker/reset escape hatch when true ("Hard mode" / no "Resets allowed"). */
  strict?: boolean;
  enabled: boolean;
}

/** Create or update a recurring scheduled block rule. Starts the service. */
export function setScheduleRule(rule: ScheduleRule): void {
  try {
    FocusBlockerModule.setScheduleRule({
      type: "schedule",
      startMinute: 0,
      endMinute: 0,
      maxOpens: 0,
      perOpenSeconds: 0,
      strict: false,
      ...rule,
    });
  } catch {
    /* no-op on web/simulator */
  }
}

/** Delete a scheduled rule. */
export function removeScheduleRule(id: string): void {
  try {
    FocusBlockerModule.removeScheduleRule(id);
  } catch {
    /* no-op */
  }
}

/** Toggle a rule without losing its configuration. */
export function setScheduleEnabled(id: string, enabled: boolean): void {
  try {
    FocusBlockerModule.setScheduleEnabled(id, enabled);
  } catch {
    /* no-op */
  }
}

/** All configured scheduled rules. */
export function getScheduleRules(): ScheduleRule[] {
  try {
    return FocusBlockerModule.getScheduleRules() as ScheduleRule[];
  } catch {
    return [];
  }
}

/** Today's recorded opens for an Open Limit rule + package. */
export function getOpenCountToday(ruleId: string, packageName: string): number {
  try {
    return FocusBlockerModule.getOpenCountToday(ruleId, packageName);
  } catch {
    return 0;
  }
}

// ---- App icons -----------------------------------------------------------------

/** Real launcher icons as base64 PNG data-URIs, keyed by package name. */
export async function getAppIcons(
  packageNames: string[]
): Promise<Record<string, string>> {
  try {
    return await FocusBlockerModule.getAppIcons(packageNames);
  } catch {
    return {};
  }
}

/** Every launchable installed app, sorted by label (excludes FocusLens itself). */
export async function getInstalledApps(): Promise<
  { packageName: string; appName: string }[]
> {
  try {
    return await FocusBlockerModule.getInstalledApps();
  } catch {
    return [];
  }
}
