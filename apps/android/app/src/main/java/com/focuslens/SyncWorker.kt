package com.focuslens

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.util.Calendar

/**
 * Background WorkManager job that runs every 15 minutes, collects today's
 * usage, and ships it to the desktop agent.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val collector = UsageCollector(applicationContext)
        if (!collector.hasPermission() || collector.agentUrl.isBlank()) return Result.success()

        val usage = collector.todayUsageSeconds()
        if (usage.isEmpty()) return Result.success()

        // Snapshot against today's midnight bucket — the agent REPLACES this
        // row each sync, so the running daily total never double-counts.
        val midnight = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val bucketTs = midnight / 1000L

        val ok = collector.sync(bucketTs, usage)
        return if (ok) Result.success() else Result.retry()
    }
}
