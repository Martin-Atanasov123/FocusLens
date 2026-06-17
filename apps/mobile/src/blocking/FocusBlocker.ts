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
