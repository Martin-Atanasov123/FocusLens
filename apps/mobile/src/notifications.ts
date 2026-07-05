/**
 * Local notifications — the retention loop's delivery channel.
 *
 * Three notification types, all local (no push infrastructure):
 *
 *  1. Session complete — scheduled at session start for the exact deadline,
 *     so it fires even if the app is killed. Cancelled on early stop.
 *  2. Streak reminder — 20:30 daily, but ONLY when today hasn't earned its
 *     streak credit yet. Re-synced on every app open: if today is already
 *     good, it moves to tomorrow. (Opal's "Day 6" promise, generalized.)
 *  3. Gem unlocked — fired immediately when a new gem is detected.
 *
 * POST_NOTIFICATIONS permission is requested during onboarding; every call
 * here is fail-soft so notifications never break core flows.
 */
import * as Notifications from "expo-notifications";

const CHANNEL_ID = "focuslens_reminders";
const ID_SESSION_END = "session-end";
const ID_STREAK = "streak-reminder";

const STREAK_HOUR = 20; // 20:30 local — late enough to matter, early enough to act
const STREAK_MINUTE = 30;

let initialized = false;

/** Idempotent setup: Android channel + foreground presentation behavior. */
export async function initNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Focus & streak reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: "#A9EEC8",
    });
  } catch {
    /* no-op outside a real device */
  }
}

/** Schedule the "session complete" notification for the session deadline. */
export async function scheduleSessionEndNotification(
  untilMs: number,
  minutes: number
): Promise<void> {
  try {
    await initNotifications();
    await Notifications.cancelScheduledNotificationAsync(ID_SESSION_END).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: ID_SESSION_END,
      content: {
        title: "Focus session complete ✅",
        body: `${minutes} minutes of pure focus — your streak is alive 🔥`,
        color: "#A9EEC8",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(untilMs),
        channelId: CHANNEL_ID,
      },
    });
  } catch {
    /* fail-soft */
  }
}

/** Cancel the pending session-end notification (session ended early). */
export async function cancelSessionEndNotification(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(ID_SESSION_END);
  } catch {
    /* fail-soft */
  }
}

/**
 * Keep exactly one streak reminder scheduled at the right moment.
 * Call on every app open / refresh with whether today already counted.
 */
export async function syncStreakReminder(
  todayAlreadyGood: boolean,
  currentStreak: number
): Promise<void> {
  try {
    await initNotifications();
    await Notifications.cancelScheduledNotificationAsync(ID_STREAK).catch(() => {});

    const target = new Date();
    target.setHours(STREAK_HOUR, STREAK_MINUTE, 0, 0);
    // Today's slot is gone (past 20:30) or already earned → aim for tomorrow.
    if (todayAlreadyGood || target.getTime() <= Date.now()) {
      target.setDate(target.getDate() + 1);
    }

    const body =
      currentStreak > 0
        ? `Your ${currentStreak}-day streak is on the line. One focus session keeps it alive.`
        : "One focus session today starts your streak. 10 minutes is enough.";

    await Notifications.scheduleNotificationAsync({
      identifier: ID_STREAK,
      content: {
        title: currentStreak > 0 ? "🔥 Streak at risk" : "Start your streak today",
        body,
        color: "#A9EEC8",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: target,
        channelId: CHANNEL_ID,
      },
    });
  } catch {
    /* fail-soft */
  }
}

/** Instant celebration when a new gem unlocks. */
export async function notifyGemUnlocked(name: string, hint: string): Promise<void> {
  try {
    await initNotifications();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `💎 Gem unlocked: ${name}`,
        body: hint,
        color: "#A9EEC8",
      },
      trigger: null, // immediate
    });
  } catch {
    /* fail-soft */
  }
}
