package expo.modules.focusblocker

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream

class FocusBlockerModule : Module() {
    private val context: Context
        get() = appContext.reactContext
            ?: throw IllegalStateException("FocusBlocker: react context unavailable")

    /** Start (or nudge) the service so it reloads limits + schedule rules. */
    private fun kickService() {
        val svc = Intent(context, FocusBlockerService::class.java).apply {
            action = FocusBlockerService.ACTION_START_LIMITS_ONLY
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            context.startForegroundService(svc)
        else
            context.startService(svc)
    }

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
            LimitStore(context).removeLimit(packageName)
            // The service checks shouldKeepRunning() on every tick and self-stops
            // when there are no limits and no active focus session. Sending ACTION_STOP
            // here would kill any in-progress focus session, which is wrong.
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

        // ---- App icons -------------------------------------------------------

        // Real launcher icons (like Opal shows) as base64 PNG data-URIs.
        // Async: rasterizing ~30 adaptive icons takes tens of ms — keep it off
        // the JS thread. Unknown packages are simply omitted from the result.
        AsyncFunction("getAppIcons") { packageNames: List<String> ->
            val pm = context.packageManager
            packageNames.mapNotNull { pkg ->
                try {
                    val drawable = pm.getApplicationIcon(pkg)
                    val size = 96
                    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
                    val canvas = Canvas(bmp)
                    drawable.setBounds(0, 0, size, size)
                    drawable.draw(canvas)
                    val baos = ByteArrayOutputStream()
                    bmp.compress(Bitmap.CompressFormat.PNG, 90, baos)
                    bmp.recycle()
                    val b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
                    pkg to "data:image/png;base64,$b64"
                } catch (e: Exception) {
                    null
                }
            }.toMap()
        }

        // ---- Scheduled rules -------------------------------------------------

        Function("setScheduleRule") { rule: Map<String, Any?> ->
            @Suppress("UNCHECKED_CAST")
            val parsed = ScheduleRule(
                id             = rule["id"] as String,
                name           = rule["name"] as? String ?: "Blocked",
                type           = rule["type"] as? String ?: "schedule",
                packageNames   = (rule["packageNames"] as? List<String>) ?: emptyList(),
                daysOfWeek     = ((rule["daysOfWeek"] as? List<Number>) ?: emptyList())
                                     .map { it.toInt() }.toSet(),
                startMinute    = (rule["startMinute"] as? Number)?.toInt() ?: 0,
                endMinute      = (rule["endMinute"] as? Number)?.toInt() ?: 0,
                maxOpens       = (rule["maxOpens"] as? Number)?.toInt() ?: 0,
                perOpenSeconds = (rule["perOpenSeconds"] as? Number)?.toInt() ?: 0,
                strict         = rule["strict"] as? Boolean ?: false,
                enabled        = rule["enabled"] as? Boolean ?: true,
            )
            ScheduleStore(context).saveRule(parsed)
            kickService()
        }

        Function("removeScheduleRule") { id: String ->
            ScheduleStore(context).removeRule(id)
            // Service self-stops via shouldKeepRunning() when nothing is left.
        }

        Function("setScheduleEnabled") { id: String, enabled: Boolean ->
            ScheduleStore(context).setEnabled(id, enabled)
            if (enabled) kickService()
        }

        Function("getScheduleRules") {
            ScheduleStore(context).getAllRules().map { r ->
                mapOf(
                    "id"             to r.id,
                    "name"           to r.name,
                    "type"           to r.type,
                    "packageNames"   to r.packageNames,
                    "daysOfWeek"     to r.daysOfWeek.toList(),
                    "startMinute"    to r.startMinute,
                    "endMinute"      to r.endMinute,
                    "maxOpens"       to r.maxOpens,
                    "perOpenSeconds" to r.perOpenSeconds,
                    "strict"         to r.strict,
                    "enabled"        to r.enabled,
                )
            }
        }

        // Today's open count for an Open Limit rule (for live "N of M" display).
        Function("getOpenCountToday") { ruleId: String, packageName: String ->
            OpenLimitTracker.todayCount(context, ruleId, packageName)
        }

        // ---- Paywall: blocking-event counter -------------------------------

        Function("getBlockEventCount") { BlockStats.count(context) }

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
