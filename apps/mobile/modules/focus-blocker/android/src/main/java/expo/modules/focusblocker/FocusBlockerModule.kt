package expo.modules.focusblocker

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FocusBlockerModule : Module() {
  private val context: Context
    get() = appContext.reactContext
      ?: throw IllegalStateException("FocusBlocker: react context unavailable")

  override fun definition() = ModuleDefinition {
    Name("FocusBlocker")

    // Drawing over other apps lets the foreground service launch BlockActivity
    // from the background (Android 10+ restricts background activity starts).
    Function("canDrawOverlays") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
        Settings.canDrawOverlays(context) else true
    }

    Function("requestOverlayPermission") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${context.packageName}")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
    }

    Function("isRunning") {
      FocusBlockerService.isRunning
    }

    Function("startBlocking") { packageNames: List<String>, untilEpochMs: Double ->
      val intent = Intent(context, FocusBlockerService::class.java).apply {
        action = FocusBlockerService.ACTION_START
        putStringArrayListExtra(FocusBlockerService.EXTRA_PACKAGES, ArrayList(packageNames))
        putExtra(FocusBlockerService.EXTRA_UNTIL, untilEpochMs.toLong())
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
        context.startForegroundService(intent)
      else
        context.startService(intent)
    }

    Function("stopBlocking") {
      val intent = Intent(context, FocusBlockerService::class.java).apply {
        action = FocusBlockerService.ACTION_STOP
      }
      context.startService(intent)
    }

    // Accurate per-app foreground time since startMs, event-paired to match
    // Digital Wellbeing. Three bugs were identified and fixed:
    //
    // BUG 1 (critical - Android 10+ under-reporting):
    // A previous version used `STOPPED = 23` labeled as "ACTIVITY_STOPPED".
    // But 23 = ACTIVITY_RESUMED (see FocusBlockerService which correctly uses
    // UsageEvents.Event.ACTIVITY_RESUMED for foreground detection). ACTIVITY_STOPPED
    // is 25. On Android 10+, queryEvents includes ACTIVITY_RESUMED (23) events on
    // every in-app navigation (Activity transitions). The bug was treating those as
    // "app went to background", closing the session on each screen transition inside
    // an app -> massive under-reporting (e.g. 17 minutes vs 2h25m real usage).
    // FIX: use ONLY MOVE_TO_FOREGROUND (1) / MOVE_TO_BACKGROUND (2) - the
    // process-level pair Digital Wellbeing itself uses for per-app totals.
    //
    // BUG 2 (orphan BACKGROUND - sessions spanning the query boundary):
    // If an app was opened before startMs (e.g. opened at 23:58, query starts at
    // midnight), there is no MOVE_TO_FOREGROUND for it in our window. When
    // MOVE_TO_BACKGROUND fires during the day, it had no matching start -> the
    // entire pre-midnight-to-background span was silently lost.
    // FIX: treat an orphan BACKGROUND as a session that started at startMs.
    //
    // BUG 3 (app open at startMs with NO events in window):
    // An app opened before startMs that remains foregrounded the entire day
    // emits no events in our window -> invisible to the event loop entirely.
    // FIX: query the 5-minute window before startMs to detect what was in
    // foreground at start time; seed it into `starts` at `start`.
    Function("usageSince") { startMs: Double ->
      val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
        ?: return@Function emptyList<Map<String, Any>>()
      val now = System.currentTimeMillis()
      val start = startMs.toLong()

      // Bug 3 fix: find which app (if any) was foregrounded just before start.
      // We look back 5 minutes - enough to catch a session that started before
      // our window but is still running. The result is seeded into `starts` so
      // both the orphan-BACKGROUND path (Bug 2) and the no-events path work.
      val priorEvents = usm.queryEvents(start - 300_000L, start)
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

      val totals = HashMap<String, Long>()  // package -> total foreground ms
      val starts = HashMap<String, Long>()  // package -> open session start timestamp

      // Seed the app that was already open at `start` (if any).
      if (pkgOpenAtStart != null) starts[pkgOpenAtStart!!] = start

      val events = usm.queryEvents(start, now)
      val event = UsageEvents.Event()

      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        val pkg = event.packageName ?: continue
        when (event.eventType) {
          UsageEvents.Event.MOVE_TO_FOREGROUND -> {
            // Keep the earliest start to handle rare double-FOREGROUND artifacts
            // (fast app switch can fire two FOREGROUND events without BACKGROUND).
            if (!starts.containsKey(pkg)) starts[pkg] = event.timeStamp
          }
          UsageEvents.Event.MOVE_TO_BACKGROUND -> {
            val s = starts.remove(pkg)
            if (s != null && event.timeStamp > s) {
              // Normal paired session.
              totals[pkg] = (totals[pkg] ?: 0L) + (event.timeStamp - s)
            } else if (s == null && event.timeStamp > start) {
              // Bug 2 fix: orphan BACKGROUND - app was foregrounded before our window.
              // Count from the window start to when it went to background.
              totals[pkg] = (totals[pkg] ?: 0L) + (event.timeStamp - start)
            }
          }
        }
      }

      // Close sessions still open at `now`: the currently-foregrounded app has a
      // FOREGROUND event but no BACKGROUND yet. Also handles Bug 3 seed entries
      // (app opened before start, still open now, emitted no events at all).
      for ((pkg, s) in starts) {
        if (now > s) totals[pkg] = (totals[pkg] ?: 0L) + (now - s)
      }

      val pm = context.packageManager
      // Launchers and SystemUI fire FOREGROUND events but are never user app usage.
      // Explicit list because getLaunchIntentForPackage is unreliable on Android 11+
      // and FLAG_SYSTEM alone would wrongly exclude preinstalled user apps (Gmail etc).
      val alwaysExclude = setOf(
        context.packageName,
        "com.android.systemui",
        "com.android.launcher",
        "com.android.launcher2",
        "com.android.launcher3",
        "com.google.android.apps.nexuslauncher",
        "com.miui.home",
        "com.huawei.android.launcher",
        "com.sec.android.app.launcher",
        "com.oneplus.launcher",
        "com.oppo.launcher",
        "com.vivo.launcher"
      )

      totals.entries.mapNotNull { (pkg, ms) ->
        if (ms < 1000) return@mapNotNull null
        if (pkg in alwaysExclude) return@mapNotNull null
        val appInfo = try {
          pm.getApplicationInfo(pkg, 0)
        } catch (e: Exception) {
          return@mapNotNull null  // package removed mid-session
        }
        // Pure background system service: FLAG_SYSTEM set AND no launcher icon.
        // Preinstalled user apps (Gmail, Chrome) have FLAG_SYSTEM but DO have a
        // launch intent - they pass through correctly.
        if ((appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0 &&
            pm.getLaunchIntentForPackage(pkg) == null) return@mapNotNull null
        val label = try {
          pm.getApplicationLabel(appInfo).toString()
        } catch (e: Exception) {
          pkg
        }
        mapOf("packageName" to pkg, "appName" to label, "secs" to (ms / 1000).toInt())
      }
    }
  }
}
