package expo.modules.focusblocker

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

data class ScheduleRule(
    val id: String,
    /** User-visible rule name, e.g. "Work Time". */
    val name: String,
    /** "schedule" (time window) or "openLimit" (opens/day cap). */
    val type: String = "schedule",
    val packageNames: List<String>,
    /** ISO day-of-week: 1=Monday .. 7=Sunday. */
    val daysOfWeek: Set<Int>,
    /** Minutes since midnight, local time. Used by "schedule" rules only. */
    val startMinute: Int = 0,
    val endMinute: Int = 0,
    /** "openLimit" only: max foreground opens per day, and seconds allowed per open. */
    val maxOpens: Int = 0,
    val perOpenSeconds: Int = 0,
    /** No joker/reset escape hatch when true ("Hard mode" / no "Resets allowed"). */
    val strict: Boolean = false,
    val enabled: Boolean = true,
)

/**
 * Persists recurring scheduled block rules (e.g. "block Instagram 9-18 on
 * weekdays") so the foreground service can enforce them without a JS bridge.
 * Each rule is stored as a JSON blob keyed by its id — unlike LimitStore's
 * per-key scheme, a rule's shape (package list + day set) doesn't fit flat keys.
 */
class ScheduleStore(private val context: Context) {

    private val prefs: SharedPreferences
        get() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun saveRule(rule: ScheduleRule) {
        val json = JSONObject().apply {
            put("id", rule.id)
            put("name", rule.name)
            put("type", rule.type)
            put("packageNames", JSONArray(rule.packageNames))
            put("daysOfWeek", JSONArray(rule.daysOfWeek.toList()))
            put("startMinute", rule.startMinute)
            put("endMinute", rule.endMinute)
            put("maxOpens", rule.maxOpens)
            put("perOpenSeconds", rule.perOpenSeconds)
            put("strict", rule.strict)
            put("enabled", rule.enabled)
        }
        prefs.edit().putString("rule_${rule.id}", json.toString()).apply()
    }

    fun removeRule(id: String) {
        prefs.edit().remove("rule_$id").apply()
    }

    fun setEnabled(id: String, enabled: Boolean) {
        getRule(id)?.let { saveRule(it.copy(enabled = enabled)) }
    }

    fun getRule(id: String): ScheduleRule? =
        prefs.getString("rule_$id", null)?.let { parseRule(it) }

    fun getAllRules(): List<ScheduleRule> =
        prefs.all.keys
            .filter { it.startsWith("rule_") }
            .mapNotNull { prefs.getString(it, null) }
            .mapNotNull { parseRule(it) }

    private fun parseRule(json: String): ScheduleRule? = try {
        val o = JSONObject(json)
        val pkgArr = o.getJSONArray("packageNames")
        val packages = (0 until pkgArr.length()).map { pkgArr.getString(it) }
        val dayArr = o.getJSONArray("daysOfWeek")
        val days = (0 until dayArr.length()).map { dayArr.getInt(it) }.toSet()
        ScheduleRule(
            id = o.getString("id"),
            name = o.optString("name", "Blocked"),
            type = o.optString("type", "schedule"),
            packageNames = packages,
            daysOfWeek = days,
            startMinute = o.optInt("startMinute", 0),
            endMinute = o.optInt("endMinute", 0),
            maxOpens = o.optInt("maxOpens", 0),
            perOpenSeconds = o.optInt("perOpenSeconds", 0),
            strict = o.optBoolean("strict", false),
            enabled = o.optBoolean("enabled", true),
        )
    } catch (e: Exception) {
        null
    }

    companion object {
        const val PREFS = "fl_schedules"

        /** True if today (local) is one of `rule`'s active days. */
        fun isTodayActiveDay(rule: ScheduleRule, nowMs: Long = System.currentTimeMillis()): Boolean {
            val cal = Calendar.getInstance()
            cal.timeInMillis = nowMs
            val isoDay = ((cal.get(Calendar.DAY_OF_WEEK) + 5) % 7) + 1
            return isoDay in rule.daysOfWeek
        }

        /** True if `nowMs` falls inside `rule`'s recurring window (local time). Schedule rules only. */
        fun isActiveNow(rule: ScheduleRule, nowMs: Long = System.currentTimeMillis()): Boolean {
            if (rule.type != "schedule" || !rule.enabled || rule.packageNames.isEmpty()) return false
            val cal = Calendar.getInstance()
            cal.timeInMillis = nowMs
            // Calendar.DAY_OF_WEEK: Sunday=1..Saturday=7. Convert to ISO: Monday=1..Sunday=7.
            val isoDay = ((cal.get(Calendar.DAY_OF_WEEK) + 5) % 7) + 1
            val minuteOfDay = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
            return if (rule.startMinute <= rule.endMinute) {
                if (isoDay !in rule.daysOfWeek) return false
                minuteOfDay in rule.startMinute until rule.endMinute
            } else {
                // Overnight window (e.g. 22:00-06:00): active either on the start day
                // after startMinute, or on the following day before endMinute.
                val prevIsoDay = if (isoDay == 1) 7 else isoDay - 1
                (isoDay in rule.daysOfWeek && minuteOfDay >= rule.startMinute) ||
                    (prevIsoDay in rule.daysOfWeek && minuteOfDay < rule.endMinute)
            }
        }

        /** The first active rule blocking `pkg` right now, if any. */
        fun activeRuleFor(
            rules: List<ScheduleRule>,
            pkg: String,
            nowMs: Long = System.currentTimeMillis(),
        ): ScheduleRule? = rules.firstOrNull { pkg in it.packageNames && isActiveNow(it, nowMs) }

        /** Epoch-ms of when `rule`'s current/next window closes, relative to `nowMs`. */
        fun windowEndMs(rule: ScheduleRule, nowMs: Long = System.currentTimeMillis()): Long {
            val cal = Calendar.getInstance()
            cal.timeInMillis = nowMs
            cal.set(Calendar.HOUR_OF_DAY, rule.endMinute / 60)
            cal.set(Calendar.MINUTE, rule.endMinute % 60)
            cal.set(Calendar.SECOND, 0)
            cal.set(Calendar.MILLISECOND, 0)
            if (rule.endMinute <= rule.startMinute && cal.timeInMillis <= nowMs) {
                cal.add(Calendar.DAY_OF_YEAR, 1)
            }
            return cal.timeInMillis
        }
    }
}
