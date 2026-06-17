/**
 * Local-first blocking rules. Two independent systems:
 *
 *  Focus Session — blocks a set of apps until a deadline (existing).
 *  Daily Limits  — per-app daily caps enforced by the native service (new).
 *
 * Focus session state is persisted in AsyncStorage (JS).
 * Daily limits are persisted in native SharedPreferences via FocusBlockerModule
 * (the service has no JS bridge) with labels mirrored to AsyncStorage for the UI.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  setLimit as nativeSetLimit,
  removeLimit as nativeRemoveLimit,
  getLimits as nativeGetLimits,
  AppLimitInfo,
} from "./FocusBlocker";

// ---- Focus Session ---------------------------------------------------------

export interface BlockRules {
  packageNames: string[];
  mode: "focusSession" | "always";
  until?: number;
}

const SESSION_KEY = "fl_block_rules";
const EMPTY: BlockRules = { packageNames: [], mode: "focusSession" };

export async function loadRules(): Promise<BlockRules> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw) as BlockRules;
    return { ...EMPTY, ...parsed, packageNames: parsed.packageNames ?? [] };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveRules(rules: BlockRules): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(rules));
}

export function isSessionActive(rules: BlockRules, now: number = Date.now()): boolean {
  return rules.mode === "focusSession" && !!rules.until && rules.until > now;
}

// ---- Daily Limits ----------------------------------------------------------

/** An app limit as the UI sees it: limit config + today's progress. */
export interface AppLimit extends AppLimitInfo {
  /** Human-readable app label (stored in AsyncStorage, not in native prefs). */
  label: string;
}

const LABELS_KEY = "fl_limit_labels";

async function loadLabels(): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(LABELS_KEY);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

async function saveLabel(packageName: string, label: string): Promise<void> {
  const labels = await loadLabels();
  labels[packageName] = label;
  await AsyncStorage.setItem(LABELS_KEY, JSON.stringify(labels));
}

async function deleteLabel(packageName: string): Promise<void> {
  const labels = await loadLabels();
  delete labels[packageName];
  await AsyncStorage.setItem(LABELS_KEY, JSON.stringify(labels));
}

/**
 * Set a daily limit. Writes to native SharedPreferences (service source of
 * truth) and mirrors the label to AsyncStorage for the UI.
 */
export async function setAppLimit(
  packageName: string,
  label: string,
  dailyLimitSecs: number
): Promise<void> {
  nativeSetLimit(packageName, dailyLimitSecs);
  await saveLabel(packageName, label);
}

/** Remove a daily limit. */
export async function removeAppLimit(packageName: string): Promise<void> {
  nativeRemoveLimit(packageName);
  await deleteLabel(packageName);
}

/**
 * Returns all configured limits with today's usage.
 * Native side provides the up-to-date usage; AsyncStorage provides the label.
 */
export async function getAppLimits(): Promise<AppLimit[]> {
  const [nativeLimits, labels] = await Promise.all([
    Promise.resolve(nativeGetLimits()),
    loadLabels(),
  ]);
  return nativeLimits.map((l) => ({
    ...l,
    label: labels[l.packageName] || l.packageName,
  }));
}
