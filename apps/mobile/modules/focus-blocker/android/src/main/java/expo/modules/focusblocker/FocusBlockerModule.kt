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

        // ---- Overlay permission --------------------------------------------

        Function("canDrawOverlays") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                Settings.canDrawOverlays(context) else true
        }

        Function("requestOverlayPermission") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
                context.startActivity(
                    Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:${context.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
        }

        // ---- Focus session -------------------------------------------------

        Function("isRunning") { FocusBlockerService.isRunning }

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
            context.startService(Intent(context, FocusBlockerService::class.java).apply {
                action = FocusBlockerService.ACTION_STOP
            })
        }

        // ---- Daily limits --------------------------------------------------

        Function("setLimit") { packageName: String, dailyLimitSecs: Int ->
            LimitStore(context).setLimit(packageName, dailyLimitSecs)
            // Ensure the service is running to enforce the limit
            val svc = Intent(context, FocusBlockerService::class.java).apply {
                action = FocusBlockerService.ACTION_START_LIMITS_ONLY
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                context.startForegroundService(svc)
            else
                context.startService(svc)
        }

        Function("removeLimit") { packageName: String ->
            val store = LimitStore(context)
            store.removeLimit(packageName)
            // Stop the service if no more limits and no active session
            if (store.getAllLimits().isEmpty()) {
                context.startService(Intent(context, FocusBlockerService::class.java).apply {
                    action = FocusBlockerService.ACTION_STOP
                })
            }
        }

        Function("getLimits") {
            val store    = LimitStore(context)
            val limits   = store.getAllLimits()
            val midnight = UsageHelper.midnightMs()
            val usage    = UsageHelper.usageSinceMs(context, midnight)
            limits.map { limit ->
                mapOf(
                    "packageName"    to limit.packageName,
                    "dailyLimitSecs" to limit.dailyLimitSecs,
                    "usedSecs"       to ((usage[limit.packageName] ?: 0L) / 1000).toInt(),
                    "jokerUsedToday" to store.isJokerUsedToday(limit.packageName),
                )
            }
        }

        // ---- Usage stats ---------------------------------------------------

        // Accurate per-app foreground seconds since startMs, event-paired to
        // match Digital Wellbeing. Core algorithm lives in UsageHelper; this
        // layer adds app-label resolution and system-service filtering.
        Function("usageSince") { startMs: Double ->
            val rawMs = UsageHelper.usageSinceMs(context, startMs.toLong())
            val pm    = context.packageManager

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
                "com.vivo.launcher",
            )

            rawMs.entries.mapNotNull { (pkg, ms) ->
                if (ms < 1000) return@mapNotNull null
                if (pkg in alwaysExclude) return@mapNotNull null
                val appInfo = try {
                    pm.getApplicationInfo(pkg, 0)
                } catch (e: Exception) {
                    return@mapNotNull null
                }
                // Exclude pure background system services (no launcher icon)
                if ((appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0 &&
                    pm.getLaunchIntentForPackage(pkg) == null) return@mapNotNull null
                val label = try {
                    pm.getApplicationLabel(appInfo).toString()
                } catch (e: Exception) { pkg }
                mapOf("packageName" to pkg, "appName" to label, "secs" to (ms / 1000).toInt())
            }
        }
    }
}
