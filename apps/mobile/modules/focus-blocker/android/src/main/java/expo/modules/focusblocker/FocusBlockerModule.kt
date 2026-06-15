package expo.modules.focusblocker

import android.content.Context
import android.content.Intent
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
  }
}
