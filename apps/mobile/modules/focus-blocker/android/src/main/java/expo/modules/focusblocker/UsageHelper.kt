package expo.modules.focusblocker

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import java.util.Calendar

/**
 * Shared utility: midnight timestamp + raw per-package foreground-ms calculation.
 * Both FocusBlockerModule (user-facing list) and FocusBlockerService (limit checks)
 * use this so the event-pairing logic lives in exactly one place.
 */
object UsageHelper {

    fun midnightMs(): Long {
        return Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
    }

    /**
     * Returns raw foreground milliseconds per package since [startMs].
     * Uses MOVE_TO_FOREGROUND / MOVE_TO_BACKGROUND pairs (same as Digital Wellbeing)
     * with all three edge-case fixes:
     *   1. Orphan BACKGROUND (app started before our window)
     *   2. App open at startMs with events in window
     *   3. App open at startMs with NO events in window (5-min lookback)
     */
    fun usageSinceMs(context: Context, startMs: Long): Map<String, Long> {
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return emptyMap()
        val now = System.currentTimeMillis()

        // Fix 3: look back 5 min to find the app that was open at startMs
        val priorEvents = usm.queryEvents(startMs - 300_000L, startMs)
        val priorEvent = UsageEvents.Event()
        var pkgOpenAtStart: String? = null
        while (priorEvents.hasNextEvent()) {
            priorEvents.getNextEvent(priorEvent)
            when (priorEvent.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> pkgOpenAtStart = priorEvent.packageName
                UsageEvents.Event.MOVE_TO_BACKGROUND ->
                    if (priorEvent.packageName == pkgOpenAtStart) pkgOpenAtStart = null
            }
        }

        val totals = HashMap<String, Long>()
        val starts = HashMap<String, Long>()
        if (pkgOpenAtStart != null) starts[pkgOpenAtStart!!] = startMs

        val events = usm.queryEvents(startMs, now)
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val pkg = event.packageName ?: continue
            when (event.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                    // Keep earliest start (rare double-FOREGROUND on fast app switch)
                    if (!starts.containsKey(pkg)) starts[pkg] = event.timeStamp
                }
                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    val s = starts.remove(pkg)
                    if (s != null && event.timeStamp > s) {
                        // Fix 1: normal paired session
                        totals[pkg] = (totals[pkg] ?: 0L) + (event.timeStamp - s)
                    } else if (s == null && event.timeStamp > startMs) {
                        // Fix 2: orphan BACKGROUND — app was open before our window
                        totals[pkg] = (totals[pkg] ?: 0L) + (event.timeStamp - startMs)
                    }
                }
            }
        }
        // Close sessions still open at now (currently-foregrounded app, Fix 3 seeds)
        for ((pkg, s) in starts) {
            if (now > s) totals[pkg] = (totals[pkg] ?: 0L) + (now - s)
        }
        return totals
    }
}
