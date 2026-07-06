package expo.modules.focusblocker

import android.content.Context

/**
 * Global "Always Allowed" whitelist (Opal's "Always Allowed Apps"). Any package
 * in this set is NEVER blocked — the foreground service short-circuits before
 * any focus-session / schedule / open-limit / daily-limit check. Lets essential
 * apps (phone, maps, messages) stay usable even inside a focus session.
 *
 * Stored as a StringSet in its own SharedPreferences file so it survives limit
 * and rule changes.
 */
object AllowStore {
    private const val PREFS = "fl_allowed"
    private const val KEY = "allowed_pkgs"

    fun getAllowed(context: Context): Set<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getStringSet(KEY, emptySet()) ?: emptySet()

    fun setAllowed(context: Context, packages: Set<String>) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putStringSet(KEY, packages).apply()
    }

    fun isAllowed(context: Context, pkg: String): Boolean =
        getAllowed(context).contains(pkg)
}
