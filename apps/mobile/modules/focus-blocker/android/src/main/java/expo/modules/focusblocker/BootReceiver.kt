package expo.modules.focusblocker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Restarts the blocking service after a device reboot or app update so daily
 * limits keep working without the user re-opening the app. Only starts the
 * service when at least one limit is configured — avoids a persistent
 * notification on fresh installs or after the user removes all limits.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val trigger = intent.action
        if (trigger != Intent.ACTION_BOOT_COMPLETED &&
            trigger != Intent.ACTION_MY_PACKAGE_REPLACED) return
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
