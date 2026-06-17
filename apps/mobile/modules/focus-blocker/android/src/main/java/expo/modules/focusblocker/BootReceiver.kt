package expo.modules.focusblocker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Restarts the blocking service after a device reboot so daily limits keep
 * working without the user opening the app. Only starts the service when at
 * least one limit is configured — avoids a persistent notification on fresh
 * installs or after the user removes all limits.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (LimitStore(context).getAllLimits().isEmpty()) return

        val svc = Intent(context, FocusBlockerService::class.java).apply {
            action = FocusBlockerService.ACTION_START_LIMITS_ONLY
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(svc)
        } else {
            context.startService(svc)
        }
    }
}
