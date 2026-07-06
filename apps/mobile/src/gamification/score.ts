/**
 * Focus Score — the single number the whole app orbits around.
 *
 * A composite of three sub-scores (Opal blends Sleep/Focus/Rest; we blend the
 * signals we actually have), so it is realistic — a perfect 100 is unreachable
 * with any real usage ("nobody's perfect"), and even a great day lands ~90s.
 *
 *   focus sub  (60% weight) — driven by total screen time on a smooth curve:
 *                 0h→100, ~2h→88, 4h→76, 6h→64, 8h→52, 12h→28 (floor 15).
 *                 −6/hour, never a "free" allowance, so it always dips.
 *   distraction sub (25%)   — share of screen time in distracting apps
 *                 (social/video/games). All-focused day → 100; a day that is
 *                 mostly doomscrolling → ~30.
 *   discipline sub (15%)    — limits respected: starts at 100, −25 per blown
 *                 limit, −10 per near-cap.
 *
 * Then completed focus sessions add a small redemption bonus (+4 each, cap 12),
 * and the result is clamped to 1..99 — there is always something to lose and
 * always a path back. Pure function (no I/O) so it stays unit-testable.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ScoreInputs {
  /** Total foreground seconds across all apps today. */
  totalScreenSecs: number;
  /** Foreground seconds today spent in distracting apps (social/video/games). */
  distractionSecs: number;
  /** Daily limits currently exceeded. */
  exceededCount: number;
  /** Daily limits at ≥80% but not exceeded. */
  nearCapCount: number;
  /** Focus sessions completed today. */
  sessionsToday: number;
}

export interface ScoreBreakdown {
  score: number;
  focusSub: number;
  distractionSub: number;
  disciplineSub: number;
  focusBonus: number;
}

const W_FOCUS = 0.6;
const W_DISTRACTION = 0.25;
const W_DISCIPLINE = 0.15;

const SCREEN_PENALTY_PER_HOUR = 6;
const FOCUS_FLOOR = 15;
const BONUS_PER_SESSION = 4;
const MAX_FOCUS_BONUS = 12;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function computeScore({
  totalScreenSecs,
  distractionSecs,
  exceededCount,
  nearCapCount,
  sessionsToday,
}: ScoreInputs): ScoreBreakdown {
  const hours = totalScreenSecs / 3600;

  // Focus sub — smooth decline with screen time; never a flat 100 in practice.
  const focusSub = clamp(100 - hours * SCREEN_PENALTY_PER_HOUR, FOCUS_FLOOR, 100);

  // Distraction sub — penalise the *share* of time that is distracting, scaled
  // by how much screen time there is (a 10-min distracted day barely matters).
  const distractionRatio = totalScreenSecs > 0 ? distractionSecs / totalScreenSecs : 0;
  const distractionSub = clamp(100 - distractionRatio * 90, 10, 100);

  // Discipline sub — limits respected.
  const disciplineSub = clamp(100 - exceededCount * 25 - nearCapCount * 10, 0, 100);

  const focusBonus = clamp(sessionsToday * BONUS_PER_SESSION, 0, MAX_FOCUS_BONUS);

  const weighted =
    focusSub * W_FOCUS + distractionSub * W_DISTRACTION + disciplineSub * W_DISCIPLINE;
  const score = clamp(Math.round(weighted + focusBonus), 1, 99);

  return { score, focusSub, distractionSub, disciplineSub, focusBonus };
}

/**
 * Package heuristic for "distracting" apps (social, video, games). Used to
 * split screen time for the distraction sub-score. Prefix/substring match so
 * it catches regional variants without an exhaustive list.
 */
const DISTRACTING = [
  "instagram", "tiktok", "musically", "youtube", "facebook", "katana", "snapchat",
  "reddit", "twitter", "com.twitter", "com.x.", ".x.android", "netflix", "primevideo",
  "disney", "hbo", "twitch", "pinterest", "tinder", "bumble", "9gag", "telegram",
  "discord", "whatsapp", "messenger", "vk.", "game", "supercell", "clashof", "roblox",
  "minecraft", "pubg", "candycrush", "king.", "playrix",
];

/** True if `pkg` looks like a distracting (social/video/games) app. */
export function isDistractingPkg(pkg: string): boolean {
  const p = pkg.toLowerCase();
  return DISTRACTING.some((frag) => p.includes(frag));
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
