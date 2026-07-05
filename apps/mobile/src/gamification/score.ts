/**
 * Focus Score — the single number the whole app orbits around.
 *
 * Design (loss-framed, Opal-style): you START each day at 100 and the day's
 * behavior erodes or defends it:
 *
 *   screen penalty  — first 2 h of screen time are free; every hour beyond
 *                     costs 8 pts (capped at −40). Heavy days hurt visibly.
 *   limit penalty   — each blown daily limit −15, each app near its cap −5
 *                     (capped at −45). Breaking your own rules hurts most.
 *   focus bonus     — each COMPLETED focus session earns +5 (capped at +15),
 *                     so a bad screen day can still be partially redeemed by
 *                     deliberate focus. Score never exceeds 100.
 *
 * Pure function — no I/O — so it is trivially unit-testable and can run in
 * both the app and any future widget/notification context.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ScoreInputs {
  /** Total foreground seconds across all apps today. */
  totalScreenSecs: number;
  /** Daily limits currently exceeded. */
  exceededCount: number;
  /** Daily limits at ≥80% but not exceeded. */
  nearCapCount: number;
  /** Focus sessions completed today. */
  sessionsToday: number;
}

export interface ScoreBreakdown {
  score: number;
  screenPenalty: number;
  limitPenalty: number;
  focusBonus: number;
}

const FREE_SCREEN_HOURS = 2;
const PENALTY_PER_HOUR = 8;
const MAX_SCREEN_PENALTY = 40;
const PENALTY_EXCEEDED = 15;
const PENALTY_NEAR_CAP = 5;
const MAX_LIMIT_PENALTY = 45;
const BONUS_PER_SESSION = 5;
const MAX_FOCUS_BONUS = 15;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function computeScore({
  totalScreenSecs,
  exceededCount,
  nearCapCount,
  sessionsToday,
}: ScoreInputs): ScoreBreakdown {
  const hours = totalScreenSecs / 3600;
  const screenPenalty = clamp(
    Math.round((hours - FREE_SCREEN_HOURS) * PENALTY_PER_HOUR),
    0,
    MAX_SCREEN_PENALTY
  );
  const limitPenalty = clamp(
    exceededCount * PENALTY_EXCEEDED + nearCapCount * PENALTY_NEAR_CAP,
    0,
    MAX_LIMIT_PENALTY
  );
  const focusBonus = clamp(sessionsToday * BONUS_PER_SESSION, 0, MAX_FOCUS_BONUS);
  const score = clamp(100 - screenPenalty - limitPenalty + focusBonus, 0, 100);
  return { score, screenPenalty, limitPenalty, focusBonus };
}

// ---- Score history (for profile trends / weekly report) -----------------------

const HISTORY_KEY = "fl_score_history"; // Record<"YYYY-MM-DD", number>
const HISTORY_DAYS = 30;

/** Persist today's latest score (overwrites today's entry; keeps 30 days). */
export async function saveScoreSnapshot(score: number): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const hist: Record<string, number> = raw ? JSON.parse(raw) : {};
    hist[new Date().toISOString().slice(0, 10)] = score;
    const keys = Object.keys(hist).sort();
    while (keys.length > HISTORY_DAYS) delete hist[keys.shift()!];
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch {
    /* history is best-effort */
  }
}

export async function getScoreHistory(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
