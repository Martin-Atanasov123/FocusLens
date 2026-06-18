package expo.modules.focusblocker

import android.content.Context

/**
 * Lifetime count of *distinct* blocking events (focus-session blocks and limit
 * blocks). Drives the "aha moment" paywall: JS reads the count and shows the
 * paywall once it crosses the free threshold.
 *
 * Stored in its own SharedPreferences file so clearing limits never resets the
 * counter. The service decides what counts as "distinct" (re-showing the same
 * block while the user lingers is not a new event) before calling increment().
 */
object BlockStats {
    private const val PREFS = "fl_block_stats"
    private const val KEY_COUNT = "block_event_count"

    fun increment(context: Context) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        p.edit().putInt(KEY_COUNT, p.getInt(KEY_COUNT, 0) + 1).apply()
    }

    fun count(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_COUNT, 0)

    /** Increment today's block count for a specific package (resets each day). */
    fun incrementForPkg(context: Context, pkg: String) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "opens_${todayKey()}_$pkg"
        p.edit().putInt(key, p.getInt(key, 0) + 1).apply()
    }

    /** Returns how many times this package triggered a block today. */
    fun todayCountForPkg(context: Context, pkg: String): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt("opens_${todayKey()}_$pkg", 0)

    private fun todayKey(): String =
        java.text.SimpleDateFormat("yyyyMMdd", java.util.Locale.US).format(java.util.Date())
}
