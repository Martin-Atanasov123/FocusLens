package expo.modules.focusblocker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * Foreground service that enforces two independent blocking systems:
 *
 *  1. Focus Session — blocks a user-chosen set of apps until a fixed deadline.
 *     Launched by JS via ACTION_START with packages + until extras.
 *
 *  2. Daily Limits — blocks any app that has exceeded its daily limit (set in
 *     LimitStore). Checked every 30 seconds. Launched on boot via BootReceiver
 *     and on first limit creation via ACTION_START_LIMITS_ONLY.
 *
 * The service keeps running as long as a session is active OR any limit is
 * configured. It stops itself only when both conditions are false, or when
 * ACTION_STOP_ALL is received.
 */
class FocusBlockerService : Service() {

    companion object {
        const val ACTION_START            = "expo.modules.focusblocker.START"
        const val ACTION_STOP             = "expo.modules.focusblocker.STOP"
        const val ACTION_START_LIMITS_ONLY = "expo.modules.focusblocker.START_LIMITS_ONLY"
        const val ACTION_STOP_ALL         = "expo.modules.focusblocker.STOP_ALL"

        const val EXTRA_PACKAGES = "packages"
        const val EXTRA_UNTIL    = "until"

        private const val CHANNEL_ID       = "focuslens_blocker"
        private const val NOTIF_ID         = 4873
        private const val TICK_MS          = 1_000L
        private const val RESHOW_GRACE_MS  = 1_500L
        private const val LIMIT_CHECK_EVERY = 30  // ticks (= 30 s)
        // A block counts as a *new* event (not a re-show) once the user has been
        // away from the blocked app for at least this long, or switches apps.
        private const val NEW_EVENT_GAP_MS = 10_000L

        @Volatile var isRunning = false
            private set
    }

    private val handler = Handler(Looper.getMainLooper())

    // Cached — avoids creating a new object on every tick
    private val limitStore by lazy { LimitStore(this) }

    // Focus-session state
    private var blocked: Set<String> = emptySet()
    private var until: Long = 0L

    // Shared foreground-detection state
    private var lastCheck: Long = 0L
    private var currentForeground: String? = null
    private var lastBlockShownAt: Long = 0L
    private var lastBlockedPkg: String? = null

    // Limit-check cadence
    private var limitTick = 0
    private var prevForeground: String? = null

    private val ticker = object : Runnable {
        override fun run() {
            try { tick() } catch (_: Exception) { /* keep ticking even if one tick throws */ }
            if (isRunning) handler.postDelayed(this, TICK_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                blocked = emptySet()
                until   = 0L
                updateNotification()
                if (!shouldKeepRunning()) stopService()
                return START_NOT_STICKY
            }
            ACTION_STOP_ALL -> {
                stopService()
                return START_NOT_STICKY
            }
            ACTION_START_LIMITS_ONLY -> {
                // Look back 5 s so we catch the app that's already in the foreground.
                // Without this, lastCheck stays 0 and queryEvents(0, now) scans from epoch.
                if (lastCheck == 0L) lastCheck = System.currentTimeMillis() - 5_000L
                ensureRunning()
            }
            ACTION_START -> {
                blocked = (intent.getStringArrayListExtra(EXTRA_PACKAGES) ?: arrayListOf()).toSet()
                until   = intent.getLongExtra(EXTRA_UNTIL, 0L)
                lastCheck = System.currentTimeMillis() - 60_000L
                ensureRunning()
            }
        }
        return START_STICKY
    }

    private fun ensureRunning() {
        if (!isRunning) {
            startForeground(NOTIF_ID, buildNotification())
            isRunning = true
            handler.removeCallbacks(ticker)
            handler.post(ticker)
        } else {
            updateNotification()
        }
    }

    // ---- Main tick ---------------------------------------------------------

    private fun tick() {
        val now = System.currentTimeMillis()

        // Clear expired focus session
        if (until in 1..now) {
            blocked = emptySet()
            until   = 0L
            updateNotification()
        }

        if (!shouldKeepRunning()) {
            stopService()
            return
        }

        updateForeground(now)
        val pkg = currentForeground ?: return
        if (pkg == packageName) return

        // Arm an immediate limit check when the user switches to a different app
        if (pkg != prevForeground) {
            prevForeground = pkg
            limitTick = LIMIT_CHECK_EVERY
        }

        // 1. Focus session check (every tick)
        if (blocked.contains(pkg) && until > now && now - lastBlockShownAt > RESHOW_GRACE_MS) {
            registerBlockEvent(pkg, now)
            lastBlockShownAt = now
            showFocusBlock(pkg)
            return
        }

        // 2. Limit check (every LIMIT_CHECK_EVERY ticks, or immediately on app switch)
        limitTick++
        if (limitTick >= LIMIT_CHECK_EVERY) {
            limitTick = 0
            checkLimit(pkg, now)
        }
    }

    private fun checkLimit(pkg: String, now: Long) {
        // Hold a brief WakeLock so the UsageStats query and Activity launch succeed
        // even when the screen is off. Auto-released after 5 s as a safety net.
        val wl = (getSystemService(POWER_SERVICE) as? PowerManager)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "focuslens:check")
            ?.also { it.acquire(5_000L) }
        try {
            val limit = limitStore.getLimit(pkg) ?: return

            if (limitStore.isJokerActiveNow(pkg)) return  // joker window still open

            val usageMs  = UsageHelper.usageSinceMs(this, UsageHelper.midnightMs())[pkg] ?: 0L
            val usedSecs = (usageMs / 1000).toInt()
            if (usedSecs < limit.dailyLimitSecs) return

            if (now - lastBlockShownAt > RESHOW_GRACE_MS) {
                registerBlockEvent(pkg, now)
                lastBlockShownAt = now
                val label = appLabel(pkg)
                showLimitBlock(pkg, label, usedSecs, limit.dailyLimitSecs)
            }
        } finally {
            wl?.let { if (it.isHeld) it.release() }
        }
    }

    // ---- Foreground detection ----------------------------------------------

    private fun updateForeground(now: Long) {
        val usm = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
        val fgType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            UsageEvents.Event.ACTIVITY_RESUMED
        else
            UsageEvents.Event.MOVE_TO_FOREGROUND
        val events = usm.queryEvents(lastCheck, now)
        val event  = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == fgType) currentForeground = event.packageName
        }
        lastCheck = now
    }

    // ---- Block-event counting ----------------------------------------------

    /**
     * Counts a blocking event for the paywall, de-duping re-shows. Must be
     * called *before* lastBlockShownAt is updated, so the gap reflects the
     * previous show. A new event = different app than last time, or the user
     * returned after being away for NEW_EVENT_GAP_MS.
     */
    private fun registerBlockEvent(pkg: String, now: Long) {
        val isNewEvent = pkg != lastBlockedPkg || now - lastBlockShownAt > NEW_EVENT_GAP_MS
        if (isNewEvent) {
            BlockStats.increment(this)
            BlockStats.incrementForPkg(this, pkg)
        }
        lastBlockedPkg = pkg
    }

    // ---- Show overlays -----------------------------------------------------

    private fun showFocusBlock(pkg: String) {
        val intent = Intent(this, BlockActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            putExtra(BlockActivity.EXTRA_PACKAGE,    pkg)
            putExtra(BlockActivity.EXTRA_UNTIL,      until)
            putExtra(BlockActivity.EXTRA_MODE,       BlockActivity.MODE_FOCUS_SESSION)
            putExtra(BlockActivity.EXTRA_OPEN_COUNT, BlockStats.todayCountForPkg(this@FocusBlockerService, pkg))
        }
        startActivity(intent)
    }

    private fun showLimitBlock(pkg: String, label: String, usedSecs: Int, limitSecs: Int) {
        val intent = Intent(this, BlockActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            putExtra(BlockActivity.EXTRA_PACKAGE,    pkg)
            putExtra(BlockActivity.EXTRA_MODE,       BlockActivity.MODE_LIMIT_EXCEEDED)
            putExtra(BlockActivity.EXTRA_APP_LABEL,  label)
            putExtra(BlockActivity.EXTRA_USED_SECS,  usedSecs)
            putExtra(BlockActivity.EXTRA_LIMIT_SECS, limitSecs)
            putExtra(BlockActivity.EXTRA_OPEN_COUNT, BlockStats.todayCountForPkg(this@FocusBlockerService, pkg))
        }
        startActivity(intent)
    }

    // ---- Lifecycle ---------------------------------------------------------

    private fun shouldKeepRunning(): Boolean {
        val sessionActive = blocked.isNotEmpty() && until > System.currentTimeMillis()
        val hasLimits     = limitStore.getAllLimits().isNotEmpty()
        return sessionActive || hasLimits
    }

    private fun stopService() {
        isRunning = false
        handler.removeCallbacks(ticker)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    override fun onDestroy() {
        isRunning = false
        handler.removeCallbacks(ticker)
        super.onDestroy()
    }

    // ---- Notification ------------------------------------------------------

    private fun buildNotification(): Notification {
        ensureChannel()
        val sessionActive = blocked.isNotEmpty() && until > System.currentTimeMillis()
        val title   = if (sessionActive) "⚡ Focus session active" else "🛡️ Daily limits active"
        val content = if (sessionActive) "Blocked apps are paused until your session ends."
                      else               "FocusLens is tracking your daily limits."
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, CHANNEL_ID)
        else
            @Suppress("DEPRECATION") Notification.Builder(this)
        return builder
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification())
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "Focus & Limits",
                        NotificationManager.IMPORTANCE_LOW)
                )
            }
        }
    }

    // ---- Helpers -----------------------------------------------------------

    private fun appLabel(pkg: String): String = try {
        val info = packageManager.getApplicationInfo(pkg, 0)
        packageManager.getApplicationLabel(info).toString()
    } catch (e: PackageManager.NameNotFoundException) { pkg }
}
