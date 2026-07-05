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
     *
     * SINGLE-FOREGROUND model (matches Digital Wellbeing): exactly one package
     * is "in front" at any moment. A RESUMED event for package X implicitly
     * closes the interval of whatever was in front before — this is critical
     * for apps like AnyDesk/remote-desktop/overlay apps that fire RESUMED but
     * never a matching PAUSED, which would otherwise count the entire day.
     * Screen-off pauses the clock; screen-on resumes it for the same package.
     * Total across all apps can never exceed wall-clock time.
     */
    fun usageSinceMs(context: Context, startMs: Long): Map<String, Long> {
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return emptyMap()
        val now = System.currentTimeMillis()

        // Look back 5 min to find the app that was already open at startMs.
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

        var current: String? = pkgOpenAtStart      // package currently in front
        var currentStart: Long = startMs           // when its open interval began
        var screenOn = true                        // assume interactive at startMs

        fun closeInterval(endTs: Long) {
            val pkg = current ?: return
            if (screenOn && endTs > currentStart) {
                totals[pkg] = (totals[pkg] ?: 0L) + (endTs - currentStart)
            }
        }

        // SCREEN_INTERACTIVE / SCREEN_NON_INTERACTIVE exist since API 28;
        // minSdk is below that only in theory — guard by raw values (15/16)
        // so this compiles against any compileSdk.
        val screenInteractive = 15
        val screenNonInteractive = 16

        val events = usm.queryEvents(startMs, now)
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val ts = event.timeStamp
            when (event.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> {  // == ACTIVITY_RESUMED
                    val pkg = event.packageName ?: continue
                    if (pkg == current) continue           // duplicate RESUMED
                    closeInterval(ts)                      // implicit pause of previous
                    current = pkg
                    currentStart = ts
                }
                UsageEvents.Event.MOVE_TO_BACKGROUND -> {  // == ACTIVITY_PAUSED
                    val pkg = event.packageName ?: continue
                    if (pkg == current) {                  // ignore pauses of non-current
                        closeInterval(ts)
                        current = null
                    }
                }
                screenNonInteractive -> {                  // screen off: clock stops
                    closeInterval(ts)
                    screenOn = false
                    currentStart = ts                      // keep pkg; restart on screen-on
                }
                screenInteractive -> {                     // screen on: clock resumes
                    screenOn = true
                    currentStart = ts
                }
            }
        }
        // Close whatever is still in front at `now`.
        closeInterval(now)

        return totals
    }
}
