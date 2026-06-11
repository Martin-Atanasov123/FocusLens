package com.focuslens

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

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

        val bucketTs = (System.currentTimeMillis() / 60_000L) * 60L
        val ok = collector.sync(bucketTs, usage)
        return if (ok) Result.success() else Result.retry()
    }
}
