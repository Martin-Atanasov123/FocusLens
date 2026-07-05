package expo.modules.focusblocker

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Per-rule, per-package daily "open" tracking for Open Limit rules
 * (Opal-style: "10 opens/day, 5 min each"). A new "open" is recorded whenever
 * the service sees `pkg` come to the foreground as a fresh app switch (the
 * caller — FocusBlockerService — already knows this from its own foreground
 * tracking, so this class just persists counts/timestamps).
 *
 * Stored in its own SharedPreferences file, keyed by rule + package + day so
 * unrelated rules never share a counter even if they target the same app.
 */
object OpenLimitTracker {
    private const val PREFS = "fl_open_limits"

    private fun today(): String =
        SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())

    /** Call once per fresh foreground switch into `pkg` under `ruleId`. */
    fun recordOpen(context: Context, ruleId: String, pkg: String, nowMs: Long) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val countKey = "count_${ruleId}_${pkg}_${today()}"
        p.edit()
            .putInt(countKey, p.getInt(countKey, 0) + 1)
            .putLong("openStart_${ruleId}_$pkg", nowMs)
            .apply()
    }

    /** Opens recorded today for this rule+package. */
    fun todayCount(context: Context, ruleId: String, pkg: String): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt("count_${ruleId}_${pkg}_${today()}", 0)

    /** Epoch-ms when the current open session started (0 if none tracked). */
    fun currentOpenStartMs(context: Context, ruleId: String, pkg: String): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong("openStart_${ruleId}_$pkg", 0L)

    /**
     * One-time daily reset grant (mirrors LimitStore's joker): adds `bonus`
     * extra opens for today, usable once per rule+package+day.
     */
    fun grantReset(context: Context, ruleId: String, pkg: String, bonus: Int) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val countKey = "count_${ruleId}_${pkg}_${today()}"
        val usedKey = "resetUsed_${ruleId}_${pkg}_${today()}"
        p.edit()
            .putInt(countKey, maxOf(0, p.getInt(countKey, 0) - bonus))
            .putBoolean(usedKey, true)
            .apply()
    }

    fun isResetUsedToday(context: Context, ruleId: String, pkg: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean("resetUsed_${ruleId}_${pkg}_${today()}", false)
}
