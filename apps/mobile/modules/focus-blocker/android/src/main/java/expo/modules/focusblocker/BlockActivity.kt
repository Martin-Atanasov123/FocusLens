package expo.modules.focusblocker

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
        const val EXTRA_RULE_NAME  = "rule_name"
        const val EXTRA_RULE_ID    = "rule_id"
        const val EXTRA_OPENS_USED = "opens_used"
        const val EXTRA_OPENS_MAX  = "opens_max"
        const val EXTRA_STRICT     = "strict"

        const val MODE_FOCUS_SESSION  = "focus_session"
        const val MODE_LIMIT_EXCEEDED = "limit_exceeded"
        const val MODE_SCHEDULE       = "schedule"
        const val MODE_OPEN_LIMIT     = "open_limit"

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
            setBackgroundColor(Color.parseColor("#0A0D0B"))
            setPadding(dp(40), dp(60), dp(40), dp(40))
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
        }

        when (mode) {
            MODE_LIMIT_EXCEEDED -> buildLimitExceededView(root)
            MODE_SCHEDULE       -> buildScheduleView(root)
            MODE_OPEN_LIMIT     -> buildOpenLimitView(root)
            else                -> buildFocusSessionView(root)
        }

        setContentView(root)
    }

    override fun onDestroy() {
        ticker?.let { handler.removeCallbacks(it) }
        super.onDestroy()
    }

    // ---- Focus session view ------------------------------------------------

    private fun buildFocusSessionView(root: LinearLayout) {
        val openCount = intent.getIntExtra(EXTRA_OPEN_COUNT, 0)
        root.addView(label("Do you really need\nthis right now? 🤔", 26f, "#F2F6F3", bold = true))
        root.addView(body("🧘 Take a breath.", topPad = 16, botPad = 16))
        if (openCount > 0) {
            val times = if (openCount == 1) "time" else "times"
            root.addView(eyebrow("Opened this $openCount $times today"))
        }
        root.addView(primaryBtn("← Back to focus") { goHome() }.apply {
            (layoutParams as? LinearLayout.LayoutParams)?.topMargin = dp(24)
        })
    }

    // ---- Scheduled-rule view -------------------------------------------------

    private fun buildScheduleView(root: LinearLayout) {
        val pkg       = intent.getStringExtra(EXTRA_PACKAGE) ?: ""
        val ruleName  = intent.getStringExtra(EXTRA_RULE_NAME) ?: "Blocked"
        val appLabel  = intent.getStringExtra(EXTRA_APP_LABEL) ?: pkg
        val untilMs   = intent.getLongExtra(EXTRA_UNTIL, 0L)
        val openCount = intent.getIntExtra(EXTRA_OPEN_COUNT, 0)
        val strict    = intent.getBooleanExtra(EXTRA_STRICT, false)

        val untilStr = if (untilMs > 0L) {
            val cal = java.util.Calendar.getInstance().apply { timeInMillis = untilMs }
            "%d:%02d".format(cal.get(java.util.Calendar.HOUR_OF_DAY),
                             cal.get(java.util.Calendar.MINUTE))
        } else ""

        val limitStore  = LimitStore(this)
        val jokerUsed   = limitStore.isJokerUsedToday(pkg)
        val jokerActive = limitStore.isJokerActiveNow(pkg)

        root.addView(eyebrow(ruleName.uppercase()))
        root.addView(label("This is your\n$ruleName time. 🛡️", 26f, "#F2F6F3", bold = true, topPad = 12))
        root.addView(label("$appLabel is paused by your schedule.", 16f, "#9BA69F", topPad = 8))
        if (untilStr.isNotEmpty()) {
            root.addView(body("Unlocks at $untilStr", topPad = 8, botPad = 8))
        }
        if (openCount > 0) {
            val times = if (openCount == 1) "time" else "times"
            root.addView(eyebrow("Opened this $openCount $times today"))
        }

        when {
            strict -> {
                root.addView(primaryBtn("← Back to focus") { goHome() }.apply {
                    (layoutParams as? LinearLayout.LayoutParams)?.topMargin = dp(24)
                })
            }
            jokerActive -> {
                val cd = body("", topPad = 16, botPad = 8)
                root.addView(cd)
                root.addView(primaryBtn("Got it ✓") { finish() })
                startJokerCountdown(pkg, cd)
            }
            !jokerUsed -> {
                val jokerBtn = primaryBtn("Take a 5 min break") {
                    limitStore.activateJoker(pkg)
                    finish()
                }.apply { (layoutParams as? LinearLayout.LayoutParams)?.topMargin = dp(24) }
                root.addView(jokerBtn)
                root.addView(ghostBtn("← Back to focus") { goHome() })
                startJokerGate(jokerBtn, "Take a 5 min break")
            }
            else -> {
                root.addView(primaryBtn("← Back to focus") { goHome() }.apply {
                    (layoutParams as? LinearLayout.LayoutParams)?.topMargin = dp(24)
                })
            }
        }
    }

    // ---- Open Limit view ----------------------------------------------------

    private fun buildOpenLimitView(root: LinearLayout) {
        val pkg       = intent.getStringExtra(EXTRA_PACKAGE) ?: ""
        val ruleId    = intent.getStringExtra(EXTRA_RULE_ID) ?: ""
        val ruleName  = intent.getStringExtra(EXTRA_RULE_NAME) ?: "Blocked"
        val appLabel  = intent.getStringExtra(EXTRA_APP_LABEL) ?: pkg
        val opensUsed = intent.getIntExtra(EXTRA_OPENS_USED, 0)
        val opensMax  = intent.getIntExtra(EXTRA_OPENS_MAX, 0)
        val strict    = intent.getBooleanExtra(EXTRA_STRICT, false)

        val resetUsed = OpenLimitTracker.isResetUsedToday(this, ruleId, pkg)

        root.addView(eyebrow(ruleName.uppercase()))
        root.addView(label("You've used your\nopens for $appLabel. 🔒", 26f, "#F2F6F3", bold = true, topPad = 12))
        root.addView(body("$opensUsed of $opensMax opens used today", topPad = 8, botPad = 24))

        if (!strict && !resetUsed) {
            root.addView(primaryBtn("Reset for today") {
                OpenLimitTracker.grantReset(this, ruleId, pkg, bonus = 3)
                finish()
            })
            root.addView(ghostBtn("← Back to focus") { goHome() })
        } else {
            root.addView(body("That's all for today. 🌙\nSee you tomorrow.", topPad = 0, botPad = 24))
            root.addView(primaryBtn("← Back to focus") { goHome() })
        }
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
        root.addView(label("You've reclaimed\n${limitMin} min today. ✊", 26f, "#F2F6F3", bold = true, topPad = 12))
        root.addView(label("$appLabel wants those minutes back.", 16f, "#9BA69F", topPad = 8))
        root.addView(body("Used $usedMin min of $limitMin min$openStr", topPad = 8, botPad = 32))

        when {
            jokerActive -> {
                // Joker window is open — show a live countdown, then let them in.
                val cd = body("", topPad = 0, botPad = 24)
                root.addView(cd)
                root.addView(primaryBtn("Got it ✓") { finish() })
                startJokerCountdown(pkg, cd)
            }
            !jokerUsed -> {
                // Offer the once-a-day joker, but make them pause first.
                val jokerBtn = primaryBtn("Use 5 more minutes") {
                    limitStore.activateJoker(pkg)
                    finish()
                }
                root.addView(jokerBtn)
                root.addView(ghostBtn("✅ I'm done for today") {
                    limitStore.markJokerExhausted(pkg)
                    goHome()
                })
                startJokerGate(jokerBtn, "Use 5 more minutes")
            }
            else -> {
                // Joker spent or declined — hard block for the rest of the day.
                root.addView(body("That's your limit for today. 🌙\nSee you tomorrow.",
                    topPad = 0, botPad = 24))
                root.addView(primaryBtn("✅ I'm done for today") { goHome() })
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
                    button.text = "🌬️ Take a breath… $remaining"
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
            setTextColor(Color.parseColor("#A9EEC8"))
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
            setTextColor(Color.parseColor("#9BA69F"))
            gravity = Gravity.CENTER
            setLineSpacing(0f, 1.3f)  // API 1+, unlike lineHeight (API 28)
            setPadding(0, dp(topPad), 0, dp(botPad))
        }

    private fun primaryBtn(text: String, onClick: () -> Unit): Button =
        Button(this).apply {
            this.text = text
            setTextColor(Color.parseColor("#08130C"))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#A9EEC8"))
                cornerRadius = dp(28).toFloat()
            }
            setPadding(dp(24), dp(14), dp(24), dp(14))
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            setOnClickListener { onClick() }
        }

    private fun ghostBtn(text: String, onClick: () -> Unit): Button =
        Button(this).apply {
            this.text = text
            setTextColor(Color.parseColor("#9BA69F"))
            setBackgroundColor(Color.TRANSPARENT)
            setPadding(dp(24), dp(14), dp(24), dp(14))
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
            setOnClickListener { onClick() }
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
