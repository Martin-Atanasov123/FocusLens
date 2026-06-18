package expo.modules.focusblocker

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
 *  LIMIT_EXCEEDED — Shows today's usage as a hero number vs the daily limit,
 *                   offers a once-per-day 5-minute joker (gated by a short
 *                   mindful countdown so it isn't a reflex tap), then
 *                   hard-blocks once the joker is spent.
 */
class BlockActivity : Activity() {

    companion object {
        const val EXTRA_PACKAGE    = "package"
        const val EXTRA_UNTIL      = "until"
        const val EXTRA_MODE       = "mode"
        const val EXTRA_APP_LABEL  = "app_label"
        const val EXTRA_USED_SECS  = "used_secs"
        const val EXTRA_LIMIT_SECS = "limit_secs"
        const val EXTRA_OPEN_COUNT = "open_count"

        const val MODE_FOCUS_SESSION  = "focus_session"
        const val MODE_LIMIT_EXCEEDED = "limit_exceeded"

        /** Seconds the user must pause before the "extra minutes" button arms. */
        private const val JOKER_GATE_SECONDS = 3
    }

    private val handler = Handler(Looper.getMainLooper())
    private var ticker: Runnable? = null

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

    override fun onDestroy() {
        ticker?.let { handler.removeCallbacks(it) }
        super.onDestroy()
    }

    // ---- Focus session view ------------------------------------------------

    private fun buildFocusSessionView(root: LinearLayout) {
        val openCount = intent.getIntExtra(EXTRA_OPEN_COUNT, 0)
        root.addView(label("Do you really need\nthis right now?", 26f, "#1C1610", bold = true))
        root.addView(body("Take a breath.", topPad = 16, botPad = 16))
        if (openCount > 0) {
            val times = if (openCount == 1) "time" else "times"
            root.addView(eyebrow("Tried to open this $openCount $times today"))
        }
        root.addView(primaryBtn("Back to focus") { goHome() }.apply {
            (layoutParams as? LinearLayout.LayoutParams)?.topMargin = dp(24)
        })
    }

    // ---- Limit exceeded view -----------------------------------------------

    private fun buildLimitExceededView(root: LinearLayout) {
        val pkg       = intent.getStringExtra(EXTRA_PACKAGE) ?: ""
        val appLabel  = intent.getStringExtra(EXTRA_APP_LABEL) ?: pkg
        val usedSecs  = intent.getIntExtra(EXTRA_USED_SECS, 0)
        val limitSecs = intent.getIntExtra(EXTRA_LIMIT_SECS, 0)

        val limitStore  = LimitStore(this)
        val jokerUsed   = limitStore.isJokerUsedToday(pkg)
        val jokerActive = limitStore.isJokerActiveNow(pkg)

        val usedMin  = (usedSecs + 59) / 60
        val limitMin = limitSecs / 60

        val openCount = intent.getIntExtra(EXTRA_OPEN_COUNT, 0)
        val openStr   = if (openCount > 0) " · opened $openCount×" else ""

        // Positive reframing: the limit is time they chose to protect
        root.addView(eyebrow("LIMIT REACHED"))
        root.addView(label("You've reclaimed\n${limitMin} min today.", 26f, "#1C1610", bold = true, topPad = 12))
        root.addView(label("$appLabel wants that back.", 16f, "#6B6256", topPad = 8))
        root.addView(body("Used $usedMin min of $limitMin min$openStr", topPad = 8, botPad = 32))

        when {
            jokerActive -> {
                // Joker window is open — show a live countdown, then let them in.
                val cd = body("", topPad = 0, botPad = 24)
                root.addView(cd)
                root.addView(primaryBtn("Got it") { finish() })
                startJokerCountdown(pkg, cd)
            }
            !jokerUsed -> {
                // Offer the once-a-day joker, but make them pause first.
                val jokerBtn = primaryBtn("Use 5 more minutes") {
                    limitStore.activateJoker(pkg)
                    finish()
                }
                root.addView(jokerBtn)
                root.addView(ghostBtn("I'm done for today") {
                    limitStore.markJokerExhausted(pkg)
                    goHome()
                })
                startJokerGate(jokerBtn, "Use 5 more minutes")
            }
            else -> {
                // Joker spent or declined — hard block for the rest of the day.
                root.addView(body("That's your limit for today.\nSee you tomorrow.",
                    topPad = 0, botPad = 24))
                root.addView(primaryBtn("I'm done for today") { goHome() })
            }
        }
    }

    /** Disable the joker button for a few seconds with a "breathe" countdown. */
    private fun startJokerGate(button: Button, readyText: String) {
        button.isEnabled = false
        button.alpha = 0.45f
        val r = object : Runnable {
            var remaining = JOKER_GATE_SECONDS
            override fun run() {
                if (remaining > 0) {
                    button.text = "Take a breath… $remaining"
                    remaining--
                    handler.postDelayed(this, 1000)
                } else {
                    button.text = readyText
                    button.isEnabled = true
                    button.alpha = 1f
                }
            }
        }
        ticker = r
        handler.post(r)
    }

    /** Live MM:SS countdown of the remaining joker time; closes at zero. */
    private fun startJokerCountdown(pkg: String, view: TextView) {
        val end = getSharedPreferences(LimitStore.PREFS, MODE_PRIVATE)
            .getLong("joker_end_$pkg", 0L)
        val r = object : Runnable {
            override fun run() {
                val remSec = ((end - System.currentTimeMillis()) / 1000).coerceAtLeast(0L)
                if (remSec <= 0L) { goHome(); return }
                view.text = "Extra time: %d:%02d left".format(remSec / 60, remSec % 60)
                handler.postDelayed(this, 1000)
            }
        }
        ticker = r
        handler.post(r)
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

    private fun eyebrow(text: String): TextView =
        TextView(this).apply {
            this.text = text
            textSize = 12f
            setTextColor(Color.parseColor("#B26A0A"))
            gravity = Gravity.CENTER
            letterSpacing = 0.18f
            setTypeface(typeface, Typeface.BOLD)
        }

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
            setLineSpacing(0f, 1.3f)  // API 1+, unlike lineHeight (API 28)
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
