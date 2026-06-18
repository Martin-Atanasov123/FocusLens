package expo.modules.focusblocker

import android.content.Context
import android.content.SharedPreferences

data class AppLimit(
    val packageName: String,
    /** Seconds of foreground use allowed per day. */
    val dailyLimitSecs: Int,
    /** Epoch-ms when the 5-minute joker window ends. 0 = not used today. */
    val jokerEndMs: Long = 0L,
)

/**
 * Persists per-app daily limits in SharedPreferences so the foreground
 * service can read them without a JS bridge (AsyncStorage is JS-only).
 *
 * Keys per package:
 *   "secs_<pkg>"       → Int   daily limit in seconds
 *   "joker_end_<pkg>"  → Long  joker-window end in epoch-ms (0 = unused)
 */
class LimitStore(private val context: Context) {

    private val prefs: SharedPreferences
        get() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun setLimit(packageName: String, dailyLimitSecs: Int) {
        prefs.edit().putInt("secs_$packageName", dailyLimitSecs).apply()
    }

    fun removeLimit(packageName: String) {
        prefs.edit()
            .remove("secs_$packageName")
            .remove("joker_end_$packageName")
            .apply()
    }

    fun getLimit(packageName: String): AppLimit? {
        val secs = prefs.getInt("secs_$packageName", -1)
        if (secs < 0) return null
        val jokerEnd = prefs.getLong("joker_end_$packageName", 0L)
        return AppLimit(packageName, secs, jokerEnd)
    }

    fun getAllLimits(): List<AppLimit> =
        prefs.all.keys
            .filter { it.startsWith("secs_") }
            .map { it.removePrefix("secs_") }
            .mapNotNull { getLimit(it) }

    /**
     * Grants a 5-minute joker window starting now.
     * Called from BlockActivity when the user taps "Use 5 extra minutes".
     */
    fun activateJoker(packageName: String, durationMs: Long = JOKER_DURATION_MS) {
        val endMs = System.currentTimeMillis() + durationMs
        prefs.edit().putLong("joker_end_$packageName", endMs).apply()
    }

    /**
     * Marks the joker as "used today" without granting any extra time.
     * Called when the user taps "I'm done for today" — ensures the next block
     * shows only the hard-stop button with no escape hatch.
     */
    fun markJokerExhausted(packageName: String) {
        // joker_end = today's midnight: isJokerUsedToday=true, isJokerActiveNow=false
        prefs.edit().putLong("joker_end_$packageName", UsageHelper.midnightMs()).apply()
    }

    /** True while the joker window is open (used today AND not yet expired). */
    fun isJokerActiveNow(packageName: String): Boolean {
        val end = prefs.getLong("joker_end_$packageName", 0L)
        val midnight = UsageHelper.midnightMs()
        return end >= midnight && System.currentTimeMillis() < end
    }

    /** True if the joker was used at any point today (active or expired). */
    fun isJokerUsedToday(packageName: String): Boolean {
        val end = prefs.getLong("joker_end_$packageName", 0L)
        return end >= UsageHelper.midnightMs()
    }

    companion object {
        const val PREFS = "fl_limits"
        const val JOKER_DURATION_MS = 5 * 60_000L
    }
}
