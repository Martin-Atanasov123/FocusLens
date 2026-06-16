export interface FocusBlockerNativeModule {
  /** True if the app can draw over other apps (also enables launching the
   *  block screen from the background service). */
  canDrawOverlays(): boolean;
  /** Opens the system "Display over other apps" settings for this app. */
  requestOverlayPermission(): void;
  /** True while a focus/blocking session is active. */
  isRunning(): boolean;
  /** Start blocking the given package names until `untilEpochMs` (unix ms). */
  startBlocking(packageNames: string[], untilEpochMs: number): void;
  /** Stop the current session immediately. */
  stopBlocking(): void;
  /** Accurate per-app foreground seconds since `startEpochMs` (Digital-
   *  Wellbeing-style event pairing). Only user-launchable apps. */
  usageSince(startEpochMs: number): { packageName: string; appName: string; secs: number }[];
}
