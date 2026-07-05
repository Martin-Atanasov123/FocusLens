/**
 * Streaks & Gems — local gamification (Opal's Focus Gems, FocusLens-style).
 *
 * A day counts toward the streak when the user COMPLETES a focus session
 * (started and ran to its deadline without being ended early). Session
 * completion is tracked via a "pending session" marker written on start:
 *  - ended early  → marker cleared, no credit
 *  - ran out      → finalizePendingSession() credits the day + totals
 * finalize is called on app open and on natural countdown end, so sessions
 * that finish while the app is closed still count.
 *
 * Everything lives in AsyncStorage — no server, consistent with the app's
 * local-first design.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STREAK_KEY = "fl_streak"; // {current, best, lastGoodDay}
const PENDING_KEY = "fl_pending_session"; // {until, minutes}
const TOTALS_KEY = "fl_focus_totals"; // {sessions, minutes}
const SESSIONS_TODAY_KEY = "fl_sessions_today"; // {date, count}

export interface Streak {
  current: number;
  best: number;
  /** "YYYY-MM-DD" of the last day that counted, or "" if none. */
  lastGoodDay: string;
}

export interface FocusTotals {
  sessions: number;
  minutes: number;
}

const EMPTY_STREAK: Streak = { current: 0, best: 0, lastGoodDay: "" };
const EMPTY_TOTALS: FocusTotals = { sessions: 0, minutes: 0 };

function dayStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function prevDayStr(day: string): string {
  const d = new Date(day + "T12:00:00Z"); // noon avoids DST edge cases
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

// ---- Streak state ------------------------------------------------------------

export async function getStreak(): Promise<Streak> {
  const s = await readJson(STREAK_KEY, EMPTY_STREAK);
  // A streak is only "current" if it reached today or yesterday; otherwise it
  // has lapsed and reads as 0 (best is preserved).
  const today = dayStr(Date.now());
  if (s.lastGoodDay && s.lastGoodDay !== today && s.lastGoodDay !== prevDayStr(today)) {
    return { ...s, current: 0 };
  }
  return s;
}

/** Credit `day` toward the streak (idempotent per day). */
export async function markGoodDay(day: string): Promise<Streak> {
  const s = await readJson(STREAK_KEY, EMPTY_STREAK);
  if (s.lastGoodDay === day) return s; // already counted
  const next: Streak =
    s.lastGoodDay === prevDayStr(day)
      ? { ...s, current: s.current + 1, lastGoodDay: day }
      : { ...s, current: 1, lastGoodDay: day };
  next.best = Math.max(next.best, next.current);
  await AsyncStorage.setItem(STREAK_KEY, JSON.stringify(next));
  return next;
}

// ---- Session completion tracking ----------------------------------------------

/** Call when a focus session starts. */
export async function markSessionStarted(untilMs: number, minutes: number): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ until: untilMs, minutes }));
}

/** Call when the user ends a session early — no streak credit. */
export async function cancelPendingSession(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY);
}

/**
 * If a previously started session has run past its deadline, credit it:
 * bump totals and mark the deadline's day as good. Safe to call often.
 * Returns the updated streak when a session was credited, else null.
 */
export async function finalizePendingSession(): Promise<Streak | null> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  let pending: { until: number; minutes: number };
  try {
    pending = JSON.parse(raw);
  } catch {
    await AsyncStorage.removeItem(PENDING_KEY);
    return null;
  }
  if (!pending.until || Date.now() < pending.until) return null; // still running

  await AsyncStorage.removeItem(PENDING_KEY);
  const totals = await readJson(TOTALS_KEY, EMPTY_TOTALS);
  await AsyncStorage.setItem(
    TOTALS_KEY,
    JSON.stringify({
      sessions: totals.sessions + 1,
      minutes: totals.minutes + (pending.minutes || 0),
    })
  );

  // Per-day session counter — feeds the Focus Score's focus bonus.
  const day = dayStr(pending.until);
  const st = await readJson(SESSIONS_TODAY_KEY, { date: "", count: 0 });
  await AsyncStorage.setItem(
    SESSIONS_TODAY_KEY,
    JSON.stringify({ date: day, count: st.date === day ? st.count + 1 : 1 })
  );

  return markGoodDay(day);
}

/** Focus sessions completed today (feeds the score's focus bonus). */
export async function getSessionsToday(): Promise<number> {
  const st = await readJson(SESSIONS_TODAY_KEY, { date: "", count: 0 });
  return st.date === dayStr(Date.now()) ? st.count : 0;
}

export async function getTotals(): Promise<FocusTotals> {
  return readJson(TOTALS_KEY, EMPTY_TOTALS);
}

// ---- Gems ----------------------------------------------------------------------

export interface Gem {
  id: string;
  name: string;
  /** How to earn it — shown under locked gems. */
  hint: string;
  /** Ionicons name used as the gem glyph. */
  icon: string;
  unlocked: boolean;
}

export interface GemInputs {
  totals: FocusTotals;
  streak: Streak;
  limitsCount: number;
  blockEventCount: number;
}

/**
 * Returns gems that just became unlocked (never seen before) and marks them
 * seen. Caller decides how to celebrate (notification, confetti, …).
 */
export async function takeNewGemUnlocks(inputs: GemInputs): Promise<Gem[]> {
  const gems = computeGems(inputs).filter((g) => g.unlocked);
  const raw = await AsyncStorage.getItem("fl_gems_seen");
  let seen: string[] = [];
  try {
    seen = raw ? JSON.parse(raw) : [];
  } catch {
    seen = [];
  }
  const fresh = gems.filter((g) => !seen.includes(g.id));
  if (fresh.length > 0) {
    await AsyncStorage.setItem(
      "fl_gems_seen",
      JSON.stringify([...seen, ...fresh.map((g) => g.id)])
    );
  }
  return fresh;
}

/** The full gem catalog, evaluated against current stats. */
export function computeGems({ totals, streak, limitsCount, blockEventCount }: GemInputs): Gem[] {
  return [
    {
      id: "first-light",
      name: "First Light",
      hint: "Complete your first focus session",
      icon: "sparkles",
      unlocked: totals.sessions >= 1,
    },
    {
      id: "guardian",
      name: "Guardian",
      hint: "Set your first daily limit",
      icon: "shield-checkmark",
      unlocked: limitsCount >= 1,
    },
    {
      id: "driven",
      name: "Driven",
      hint: "Focus for 10 hours in total",
      icon: "flash",
      unlocked: totals.minutes >= 600,
    },
    {
      id: "steadfast",
      name: "Steadfast",
      hint: "Keep a 7-day streak",
      icon: "flame",
      unlocked: streak.best >= 7,
    },
    {
      id: "tenacious",
      name: "Tenacious",
      hint: "Keep a 30-day streak",
      icon: "trophy",
      unlocked: streak.best >= 30,
    },
    {
      id: "iron-will",
      name: "Iron Will",
      hint: "Walk away from 50 blocks",
      icon: "barbell",
      unlocked: blockEventCount >= 50,
    },
  ];
}
