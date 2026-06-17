export interface AppLimitInfo {
  packageName: string;
  dailyLimitSecs: number;
  usedSecs: number;
  jokerUsedToday: boolean;
}

export interface FocusBlockerNativeModule {
  /** True if the app can draw over other apps. */
  canDrawOverlays(): boolean;
  /** Opens the system "Display over other apps" settings for this app. */
  requestOverlayPermission(): void;
  /** True while a focus/blocking session or limits service is active. */
  isRunning(): boolean;
  /** Start blocking the given package names until `untilEpochMs` (unix ms). */
  startBlocking(packageNames: string[], untilEpochMs: number): void;
  /** Stop the current focus session (limits service keeps running if limits exist). */
  stopBlocking(): void;
  /** Set a daily limit for a package (seconds). Starts the service if needed. */
  setLimit(packageName: string, dailyLimitSecs: number): void;
  /** Remove a daily limit. Stops the service if no limits remain. */
  removeLimit(packageName: string): void;
  /** Returns all configured limits with today's usage. */
  getLimits(): AppLimitInfo[];
  /** Accurate per-app foreground seconds since `startEpochMs`. */
  usageSince(startEpochMs: number): { packageName: string; appName: string; secs: number }[];
}
