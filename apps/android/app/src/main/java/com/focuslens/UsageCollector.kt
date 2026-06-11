package com.focuslens

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.SharedPreferences
import android.os.Process
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar

/**
 * Reads per-app foreground usage for today via UsageStatsManager and ships
 * minute-bucket events to the FocusLens desktop agent over local Wi-Fi.
 *
 * Requires: PACKAGE_USAGE_STATS permission (granted by user in Settings →
 * Digital Wellbeing / Special App Access → Usage access).
 */
class UsageCollector(private val context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("focuslens", Context.MODE_PRIVATE)

    val agentUrl: String
        get() = prefs.getString("agent_url", "") ?: ""

    val token: String
        get() = prefs.getString("agent_token", "") ?: ""

    fun hasPermission(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            context.packageName
        )
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /**
     * Returns today's per-package active foreground seconds since midnight.
     * Map: packageName → activeSeconds
     */
    fun todayUsageSeconds(): Map<String, Long> {
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val startMs = cal.timeInMillis
        val endMs = System.currentTimeMillis()

        val events = usm.queryEvents(startMs, endMs)
        val result = mutableMapOf<String, Long>()
        val resumeTimes = mutableMapOf<String, Long>()

        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            when (event.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> {
                    resumeTimes[event.packageName] = event.timeStamp
                }
                UsageEvents.Event.ACTIVITY_PAUSED -> {
                    val start = resumeTimes.remove(event.packageName) ?: continue
                    val secs = (event.timeStamp - start) / 1000L
                    result[event.packageName] = (result[event.packageName] ?: 0L) + secs
                }
            }
        }
        // Apps still in foreground at query time
        val now = System.currentTimeMillis()
        for ((pkg, start) in resumeTimes) {
            val secs = (now - start) / 1000L
            result[pkg] = (result[pkg] ?: 0L) + secs
        }
        return result
    }

    /**
     * POSTs a batch of minute-bucket records to the desktop agent.
     * Payload: { source: "android", records: [{key, active_secs, bucket_ts}] }
     */
    suspend fun sync(bucketTs: Long, usageSeconds: Map<String, Long>): Boolean =
        withContext(Dispatchers.IO) {
            val url = agentUrl.trimEnd('/') + "/events"
            if (url.startsWith("/events") || token.isBlank()) return@withContext false

            val records = JSONArray()
            for ((pkg, secs) in usageSeconds) {
                records.put(JSONObject().apply {
                    put("kind", "app")
                    put("key", pkg)
                    put("active_secs", secs)
                    put("bucket_ts", bucketTs)
                })
            }

            val body = JSONObject().apply {
                put("source", "android")
                put("records", records)
            }.toString().toByteArray(Charsets.UTF_8)

            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("x-focuslens-token", token)
                conn.doOutput = true
                conn.connectTimeout = 4000
                conn.readTimeout = 4000
                conn.outputStream.use { it.write(body) }
                conn.responseCode in 200..299
            } catch (e: Exception) {
                false
            }
        }
}
