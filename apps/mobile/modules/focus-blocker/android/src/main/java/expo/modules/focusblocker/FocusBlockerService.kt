package expo.modules.focusblocker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

/**
 * Foreground service that polls the current foreground app (~1 Hz via
 * UsageStats — the permission the app already requests) and, while a focus
 * session is active, throws up [BlockActivity] whenever a blocked app comes to
 * the front. Stops itself when the session's end time passes.
 *
 * This is intentionally a friction speed-bump, not DRM: a determined user can
 * leave, which is the right model for a wellbeing tool and keeps us clear of
 * AccessibilityService (Play Store risk).
 */
class FocusBlockerService : Service() {
  companion object {
    const val ACTION_START = "expo.modules.focusblocker.START"
    const val ACTION_STOP = "expo.modules.focusblocker.STOP"
    const val EXTRA_PACKAGES = "packages"
    const val EXTRA_UNTIL = "until"

    private const val CHANNEL_ID = "focuslens_blocker"
    private const val NOTIF_ID = 4873
    private const val TICK_MS = 1000L
    private const val RESHOW_GRACE_MS = 1500L

    @Volatile
    var isRunning = false
      private set
  }

  private val handler = Handler(Looper.getMainLooper())
  private var blocked: Set<String> = emptySet()
  private var until: Long = 0L
  private var lastCheck: Long = 0L
  private var currentForeground: String? = null
  private var lastBlockShownAt: Long = 0L

  private val ticker = object : Runnable {
    override fun run() {
      tick()
      if (isRunning) handler.postDelayed(this, TICK_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopBlocking()
        return START_NOT_STICKY
      }
      ACTION_START -> {
        blocked = (intent.getStringArrayListExtra(EXTRA_PACKAGES) ?: arrayListOf()).toSet()
        until = intent.getLongExtra(EXTRA_UNTIL, 0L)
        // Seed the lookback so an app that is ALREADY open when the session
        // starts is caught on the first tick.
        lastCheck = System.currentTimeMillis() - 60_000L
        startForeground(NOTIF_ID, buildNotification())
        isRunning = true
        handler.removeCallbacks(ticker)
        handler.post(ticker)
      }
    }
    return START_STICKY
  }

  private fun tick() {
    val now = System.currentTimeMillis()
    if (until in 1..now) {
      stopBlocking()
      return
    }
    updateForeground(now)
    val pkg = currentForeground ?: return
    if (pkg == packageName) return // never block ourselves / our own block screen
    if (blocked.contains(pkg) && now - lastBlockShownAt > RESHOW_GRACE_MS) {
      lastBlockShownAt = now
      showBlock(pkg)
    }
  }

  private fun updateForeground(now: Long) {
    val usm = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
    val foregroundType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
      UsageEvents.Event.ACTIVITY_RESUMED else UsageEvents.Event.MOVE_TO_FOREGROUND
    val events = usm.queryEvents(lastCheck, now)
    val event = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      if (event.eventType == foregroundType) {
        currentForeground = event.packageName
      }
    }
    lastCheck = now
  }

  private fun showBlock(pkg: String) {
    val intent = Intent(this, BlockActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      putExtra(BlockActivity.EXTRA_PACKAGE, pkg)
      putExtra(BlockActivity.EXTRA_UNTIL, until)
    }
    startActivity(intent)
  }

  private fun stopBlocking() {
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

  private fun buildNotification(): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL_ID) == null) {
        nm.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Focus session", NotificationManager.IMPORTANCE_LOW)
        )
      }
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("Focus session active")
      .setContentText("Blocked apps are paused until your session ends.")
      .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
      .setOngoing(true)
      .build()
  }
}
