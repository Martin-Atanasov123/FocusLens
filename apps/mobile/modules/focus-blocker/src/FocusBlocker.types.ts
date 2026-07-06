export interface AppLimitInfo {
  packageName: string;
  dailyLimitSecs: number;
  usedSecs: number;
  jokerUsedToday: boolean;
}

export type ScheduleRuleType = "schedule" | "openLimit";

export interface ScheduleRuleData {
  id: string;
  /** User-visible name, e.g. "Work Time". */
  name: string;
  type: ScheduleRuleType;
  packageNames: string[];
  /** ISO day-of-week: 1=Monday .. 7=Sunday. */
  daysOfWeek: number[];
  /** "schedule" only: minutes since local midnight. Overnight (start > end) allowed. */
  startMinute: number;
  endMinute: number;
  /** "openLimit" only: max foreground opens per day, and seconds allowed per open. */
  maxOpens: number;
  perOpenSeconds: number;
  /** No joker/reset escape hatch when true. */
  strict: boolean;
  enabled: boolean;
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
  /** Lifetime count of distinct blocking events (drives the paywall). */
  getBlockEventCount(): number;
  /** Accurate per-app foreground seconds since `startEpochMs`. */
  usageSince(startEpochMs: number): { packageName: string; appName: string; secs: number }[];
  /** Create or update a recurring scheduled block rule. Starts the service. */
  setScheduleRule(rule: ScheduleRuleData): void;
  /** Delete a scheduled rule. Service self-stops if nothing else is active. */
  removeScheduleRule(id: string): void;
  /** Toggle a rule without losing its configuration. */
  setScheduleEnabled(id: string, enabled: boolean): void;
  /** Returns all configured scheduled rules. */
  getScheduleRules(): ScheduleRuleData[];
  /** Today's recorded opens for an Open Limit rule + package (live "N of M"). */
  getOpenCountToday(ruleId: string, packageName: string): number;
  /** Replace the global Always-Allowed whitelist (packages never blocked). */
  setAllowedApps(packageNames: string[]): void;
  /** Current Always-Allowed whitelist. */
  getAllowedApps(): string[];
  /** Launcher icons as base64 PNG data-URIs, keyed by package (missing = no icon). */
  getAppIcons(packageNames: string[]): Promise<Record<string, string>>;
  /** Every launchable installed app as {packageName, appName}, sorted by label. */
  getInstalledApps(): Promise<{ packageName: string; appName: string }[]>;
}
