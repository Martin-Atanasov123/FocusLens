package expo.modules.focusblocker

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Full-screen "stay focused" screen shown over a blocked app. Friction, not a
 *  cage: the only action sends the user home (back also goes home). */
class BlockActivity : Activity() {
  companion object {
    const val EXTRA_PACKAGE = "package"
    const val EXTRA_UNTIL = "until"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#F2EDE3")) // warm cream
      setPadding(dp(40), dp(40), dp(40), dp(40))
      layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
    }

    val title = TextView(this).apply {
      text = "Stay focused"
      textSize = 28f
      setTextColor(Color.parseColor("#1C1610"))
      gravity = Gravity.CENTER
    }

    val message = TextView(this).apply {
      text = "This app is paused during your focus session."
      textSize = 16f
      setTextColor(Color.parseColor("#6B6256"))
      gravity = Gravity.CENTER
      setPadding(0, dp(16), 0, dp(32))
    }

    val backToFocus = Button(this).apply {
      text = "Back to focus"
      setTextColor(Color.WHITE)
      setBackgroundColor(Color.parseColor("#B26A0A")) // amber
      setPadding(dp(24), dp(12), dp(24), dp(12))
      layoutParams = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT)
      setOnClickListener { goHome() }
    }

    root.addView(title)
    root.addView(message)
    root.addView(backToFocus)
    setContentView(root)
  }

  @Suppress("OVERRIDE_DEPRECATION")
  override fun onBackPressed() = goHome()

  private fun goHome() {
    startActivity(
      Intent(Intent.ACTION_MAIN).apply {
        addCategory(Intent.CATEGORY_HOME)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
    )
    finish()
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
