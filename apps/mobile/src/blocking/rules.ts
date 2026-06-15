/**
 * Local-first blocking rules. A focus session blocks a set of apps until a
 * deadline; persisted so the UI can restore state and re-arm after restarts.
 * No backend — this lives entirely on-device.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface BlockRules {
  /** Android package names to block (e.g. "com.instagram.android"). */
  packageNames: string[];
  /** "focusSession" = blocks only until `until`; "always" = continuous. */
  mode: "focusSession" | "always";
  /** Epoch ms when a focus session ends (for mode === "focusSession"). */
  until?: number;
}

const KEY = "fl_block_rules";

const EMPTY: BlockRules = { packageNames: [], mode: "focusSession" };

export async function loadRules(): Promise<BlockRules> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw) as BlockRules;
    return { ...EMPTY, ...parsed, packageNames: parsed.packageNames ?? [] };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveRules(rules: BlockRules): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(rules));
}

/** A session is live if it's a focus session with a future deadline. */
export function isSessionActive(rules: BlockRules, now: number = Date.now()): boolean {
  return rules.mode === "focusSession" && !!rules.until && rules.until > now;
}
