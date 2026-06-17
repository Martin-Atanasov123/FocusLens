package expo.modules.focusblocker

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Full-screen overlay shown over a blocked app. Supports two modes:
 *
 *  FOCUS_SESSION — "Stay focused" screen, single "Back to focus" button.
 *  LIMIT_EXCEEDED — Shows today's usage vs limit, offers a once-per-day
 *                   5-minute joker, then hard-blocks after it expires.
 */
class BlockActivity : Activity() {

    companion object {
        const val EXTRA_PACKAGE   = "package"
        const val EXTRA_UNTIL     = "until"
        const val EXTRA_MODE      = "mode"
        const val EXTRA_APP_LABEL = "app_label"
        const val EXTRA_USED_SECS = "used_secs"
        const val EXTRA_LIMIT_SECS = "limit_secs"

        const val MODE_FOCUS_SESSION  = "focus_session"
        const val MODE_LIMIT_EXCEEDED = "limit_exceeded"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_FOCUS_SESSION
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#F2EDE3"))
            setPadding(dp(40), dp(60), dp(40), dp(40))
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
        }

        if (mode == MODE_LIMIT_EXCEEDED) buildLimitExceededView(root)
        else buildFocusSessionView(root)

        setContentView(root)
    }

    // ---- Focus session view ------------------------------------------------

    private fun buildFocusSessionView(root: LinearLayout) {
        root.addView(label("Stay focused", 28f, "#1C1610", bold = true))
        root.addView(body("This app is paused during your focus session.", topPad = 16, botPad = 32))
        root.addView(primaryBtn("Back to focus") { goHome() })
    }

    // ---- Limit exceeded view -----------------------------------------------

    private fun buildLimitExceededView(root: LinearLayout) {
        val pkg       = intent.getStringExtra(EXTRA_PACKAGE) ?: ""
        val appLabel  = intent.getStringExtra(EXTRA_APP_LABEL) ?: pkg
        val usedSecs  = intent.getIntExtra(EXTRA_USED_SECS, 0)
        val limitSecs = intent.getIntExtra(EXTRA_LIMIT_SECS, 0)

        val limitStore   = LimitStore(this)
        val jokerUsed    = limitStore.isJokerUsedToday(pkg)
        val jokerActive  = limitStore.isJokerActiveNow(pkg)

        root.addView(label("Time's up", 28f, "#1C1610", bold = true))
        root.addView(label(appLabel, 18f, "#B26A0A", topPad = 8))

        val usedMin  = (usedSecs  + 59) / 60
        val limitMin = limitSecs / 60
        root.addView(body("You've used this app for $usedMin min today (limit: $limitMin min).",
            topPad = 16, botPad = 32))

        when {
            jokerActive -> {
                // Joker is ticking — just let them back in, overlay will reappear when it expires
                root.addView(body("Extra time is running — you have ${jokerMinutesLeft(pkg)} min left.",
                    topPad = 0, botPad = 24))
                root.addView(primaryBtn("Got it") { finish() })
            }
            !jokerUsed -> {
                root.addView(primaryBtn("Use 5 extra minutes (once today)") {
                    limitStore.activateJoker(pkg)
                    finish()
                })
                root.addView(ghostBtn("I'm done") { goHome() })
            }
            else -> {
                // Joker expired — hard block
                root.addView(body("You already used your extra time today.", topPad = 0, botPad = 24))
                root.addView(primaryBtn("I'm done") { goHome() })
            }
        }
    }

    private fun jokerMinutesLeft(pkg: String): Int {
        val end = getSharedPreferences(LimitStore.PREFS, MODE_PRIVATE)
            .getLong("joker_end_$pkg", 0L)
        val remaining = (end - System.currentTimeMillis()).coerceAtLeast(0L)
        return ((remaining / 1000 + 59) / 60).toInt()
    }

    // ---- Navigation --------------------------------------------------------

    @Suppress("OVERRIDE_DEPRECATION")
    override fun onBackPressed() = goHome()

    private fun goHome() {
        startActivity(Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        })
        finish()
    }

    // ---- View helpers ------------------------------------------------------

    private fun label(text: String, size: Float, color: String,
                      bold: Boolean = false, topPad: Int = 0): TextView =
        TextView(this).apply {
            this.text = text
            textSize = size
            setTextColor(Color.parseColor(color))
            gravity = Gravity.CENTER
            if (bold) setTypeface(typeface, Typeface.BOLD)
            if (topPad > 0) setPadding(0, dp(topPad), 0, 0)
        }

    private fun body(text: String, topPad: Int, botPad: Int): TextView =
        TextView(this).apply {
            this.text = text
            textSize = 15f
            setTextColor(Color.parseColor("#6B6256"))
            gravity = Gravity.CENTER
            lineHeight = dp(22)
            setPadding(0, dp(topPad), 0, dp(botPad))
        }

    private fun primaryBtn(text: String, onClick: () -> Unit): Button =
        Button(this).apply {
            this.text = text
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#B26A0A"))
            setPadding(dp(24), dp(14), dp(24), dp(14))
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            setOnClickListener { onClick() }
        }

    private fun ghostBtn(text: String, onClick: () -> Unit): Button =
        Button(this).apply {
            this.text = text
            setTextColor(Color.parseColor("#6B6256"))
            setBackgroundColor(Color.TRANSPARENT)
            setPadding(dp(24), dp(14), dp(24), dp(14))
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
            setOnClickListener { onClick() }
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
