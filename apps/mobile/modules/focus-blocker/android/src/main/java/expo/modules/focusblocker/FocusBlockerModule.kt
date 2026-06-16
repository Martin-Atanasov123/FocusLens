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

    // Drawing over other apps both renders nothing of its own here AND is what
    // lets the foreground service launch BlockActivity from the background
    // (Android 10+ restricts background activity starts otherwise).
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

    // Accurate per-app foreground time since `startMs`, computed by pairing
    // RESUMED→PAUSED/STOPPED events and capping the currently-open session at
    // now. Matches Digital Wellbeing: no launch-intent filter (getLaunchIntentForPackage
    // returns null for ~95% of packages on Android 11+ without <queries>, which was the
    // root cause of "17 minutes" under-reporting). System UI and pure background
    // services are excluded by FLAG_SYSTEM + no launch intent check instead.
    Function("usageSince") { startMs: Double ->
      val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
        ?: return@Function emptyList<Map<String, Any>>()
      val now = System.currentTimeMillis()
      val events = usm.queryEvents(startMs.toLong(), now)

      val totals = HashMap<String, Long>()   // package -> foreground ms
      val starts = HashMap<String, Long>()   // package -> open RESUMED timestamp
      val event = UsageEvents.Event()
      val RESUMED = UsageEvents.Event.MOVE_TO_FOREGROUND  // 1
      val PAUSED = UsageEvents.Event.MOVE_TO_BACKGROUND   // 2
      val STOPPED = 23                                    // ACTIVITY_STOPPED (API 29+)

      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        val pkg = event.packageName ?: continue
        when (event.eventType) {
          // Edge case: double RESUMED without PAUSED (e.g. fast app switch) → keep earliest start
          RESUMED -> { if (!starts.containsKey(pkg)) starts[pkg] = event.timeStamp }
          PAUSED, STOPPED -> {
            val s = starts.remove(pkg)
            if (s != null && event.timeStamp > s) {
              totals[pkg] = (totals[pkg] ?: 0L) + (event.timeStamp - s)
            }
          }
        }
      }
      // Close any session still open at `now` (currently foregrounded app, or
      // screen-off race where PAUSED hasn't fired yet).
      for ((pkg, s) in starts) {
        if (now > s) totals[pkg] = (totals[pkg] ?: 0L) + (now - s)
      }

      val pm = context.packageManager
      // Launchers/SystemUI that generate foreground events but are never "app usage".
      // We use an explicit list because getLaunchIntentForPackage is unreliable on
      // Android 11+ and FLAG_SYSTEM alone would wrongly exclude preinstalled user apps
      // like Gmail, Chrome, Maps.
      val alwaysExclude = setOf(
        context.packageName,         // FocusLens itself
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
        if (ms < 1000) return@mapNotNull null          // sub-second glitch → skip
        if (pkg in alwaysExclude) return@mapNotNull null

        val appInfo = try {
          pm.getApplicationInfo(pkg, 0)
        } catch (e: Exception) {
          // Package removed mid-session or invisible to PM even with USAGE_STATS → skip
          return@mapNotNull null
        }
        // Pure background system service: FLAG_SYSTEM set AND no launcher icon.
        // Preinstalled user apps (Gmail, Chrome, etc.) have FLAG_SYSTEM but DO have
        // a launch intent — they pass through here correctly.
        val isSystemService = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0 &&
            pm.getLaunchIntentForPackage(pkg) == null
        if (isSystemService) return@mapNotNull null

        val label = try {
          pm.getApplicationLabel(appInfo).toString()
        } catch (e: Exception) {
          pkg  // fallback to package name if label lookup fails
        }
        mapOf("packageName" to pkg, "appName" to label, "secs" to (ms / 1000).toInt())
      }
    }
  }
}
