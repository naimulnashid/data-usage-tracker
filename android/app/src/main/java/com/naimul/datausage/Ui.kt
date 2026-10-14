package com.naimul.datausage

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.StateListDrawable
import android.text.InputType
import android.text.method.HideReturnsTransformationMethod
import android.text.method.PasswordTransformationMethod
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView

/**
 * The app's look, in code.
 *
 * The same reason as everything else here: no dependencies, so no Material
 * Components and no AppCompat -- only framework views and drawables, styled to
 * match the dashboard. True black, cards lifted by a faint border rather than
 * a shadow (a black shadow on black does nothing), and Android Green, the
 * accent the dashboard gives this device. The hex values are the dashboard's
 * own (`src/lib/accent.ts`, `globals.css`); keep them in step.
 */
object Palette {
    const val BG = 0xFF000000.toInt()
    const val CARD = 0xFF0E0F11.toInt()
    const val CARD_BORDER = 0xFF1F2125.toInt()
    const val INPUT = 0xFF16181B.toInt()
    const val INPUT_BORDER = 0xFF2A2D33.toInt()
    const val TEXT = 0xFFF2F2F5.toInt()
    const val TEXT_DIM = 0xFFA9A9B4.toInt()
    /** The dashboard's --text-faint: 4.6:1 on black, the floor for small text. */
    const val TEXT_FAINT = 0xFF7C7C88.toInt()
    const val ACCENT = 0xFF3DDC84.toInt()
    const val ACCENT_BRIGHT = 0xFF66EDA5.toInt()
    /** Text on the green: near-black, 10.57:1. White on it would be 1.78:1. */
    const val ON_ACCENT = 0xFF06140C.toInt()
    const val ACCENT_DIM = 0x223DDC84
    const val WARN = 0xFFF5B83D.toInt()
    const val WARN_DIM = 0x22F5B83D
    /** Red is for genuine problems only, as on the dashboard. */
    const val BAD = 0xFFFF6B6B.toInt()
    const val BAD_DIM = 0x22FF6B6B
}

class Ui(private val context: Context) {

    fun dp(v: Int): Int = (v * context.resources.displayMetrics.density).toInt()
    private fun dpf(v: Int): Float = v * context.resources.displayMetrics.density

    private val medium: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)

    fun rounded(fill: Int, radius: Int, stroke: Int = 0, strokeColor: Int = Color.TRANSPARENT) =
        GradientDrawable().apply {
            setColor(fill)
            cornerRadius = dpf(radius)
            if (stroke > 0) setStroke(dp(stroke), strokeColor)
        }

    private fun pressable(base: Drawable, radius: Int, ripple: Int): Drawable =
        RippleDrawable(ColorStateList.valueOf(ripple), base, rounded(Color.WHITE, radius))

    fun column(): LinearLayout = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }

    fun row(): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }

    fun gap(height: Int): View = View(context).apply {
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, dp(height))
    }

    fun divider(): View = View(context).apply {
        background = ColorDrawable(Palette.CARD_BORDER)
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, dp(1)).apply {
            topMargin = dp(16)
            bottomMargin = dp(16)
        }
    }

    /* ------------------------------------------------------------ text */

    fun text(
        value: String = "",
        size: Float = 14f,
        color: Int = Palette.TEXT_DIM,
        bold: Boolean = false,
    ) = TextView(context).apply {
        text = value
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        setTextColor(color)
        if (bold) typeface = medium
        setLineSpacing(0f, 1.2f)
    }

    /** Small caps-style section label above a group of controls. */
    fun overline(value: String) = text(value.uppercase(), 11f, Palette.TEXT_FAINT, bold = true).apply {
        letterSpacing = 0.08f
    }

    /* ----------------------------------------------------------- cards */

    /**
     * A card: a titled panel with its own body column, returned so callers
     * add their controls to it. `subtitle` is a TextView so it can change.
     */
    class Card(val view: LinearLayout, val body: LinearLayout, val subtitle: TextView)

    fun card(title: String, subtitle: String = ""): Card {
        val outer = column().apply {
            background = rounded(Palette.CARD, 18, 1, Palette.CARD_BORDER)
            setPadding(dp(18), dp(18), dp(18), dp(18))
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
                topMargin = dp(14)
            }
        }
        outer.addView(text(title, 17f, Palette.TEXT, bold = true))
        val sub = text(subtitle, 13.5f, Palette.TEXT_DIM).apply {
            setPadding(0, dp(4), 0, 0)
            visibility = if (subtitle.isEmpty()) View.GONE else View.VISIBLE
        }
        outer.addView(sub)
        val body = column().apply { setPadding(0, dp(14), 0, 0) }
        outer.addView(body)
        return Card(outer, body, sub)
    }

    /* --------------------------------------------------------- buttons */

    enum class Kind { PRIMARY, SECONDARY, QUIET, DANGER }

    fun button(label: String, kind: Kind = Kind.SECONDARY, onClick: () -> Unit) = TextView(context).apply {
        text = label
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        typeface = medium
        isClickable = true
        isFocusable = true
        minHeight = dp(48)
        setPadding(dp(18), dp(12), dp(18), dp(12))
        when (kind) {
            Kind.PRIMARY -> {
                setTextColor(Palette.ON_ACCENT)
                background = pressable(rounded(Palette.ACCENT, 14), 14, 0x33000000)
            }
            Kind.SECONDARY -> {
                setTextColor(Palette.TEXT)
                background = pressable(rounded(Palette.INPUT, 14, 1, Palette.INPUT_BORDER), 14, 0x22FFFFFF)
            }
            Kind.QUIET -> {
                setTextColor(Palette.ACCENT)
                background = pressable(rounded(Color.TRANSPARENT, 14), 14, Palette.ACCENT_DIM)
            }
            Kind.DANGER -> {
                setTextColor(Palette.BAD)
                background = pressable(rounded(Color.TRANSPARENT, 14), 14, Palette.BAD_DIM)
            }
        }
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(10) }
        setOnClickListener { onClick() }
    }

    /** A small button that sits at the end of a row. */
    fun smallButton(label: String, onClick: () -> Unit) = TextView(context).apply {
        text = label
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
        typeface = medium
        setTextColor(Palette.ON_ACCENT)
        gravity = Gravity.CENTER
        setPadding(dp(14), dp(8), dp(14), dp(8))
        background = pressable(rounded(Palette.ACCENT, 999), 999, 0x33000000)
        isClickable = true
        setOnClickListener { onClick() }
    }

    /** A pill label: "On", "Needs attention". */
    fun badge(value: String, fg: Int, bg: Int) = text(value, 12f, fg, bold = true).apply {
        background = rounded(bg, 999)
        setPadding(dp(10), dp(3), dp(10), dp(3))
    }

    /* ---------------------------------------------------------- inputs */

    fun field(hintText: String, inputKind: Int) = EditText(context).apply {
        hint = hintText
        inputType = inputKind
        setSingleLine()
        setTextColor(Palette.TEXT)
        setHintTextColor(Palette.TEXT_FAINT)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), rounded(Palette.INPUT, 12, 2, Palette.ACCENT))
            addState(intArrayOf(), rounded(Palette.INPUT, 12, 1, Palette.INPUT_BORDER))
        }
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
    }

    fun fieldLabel(value: String) = text(value, 13f, Palette.TEXT_DIM, bold = true).apply {
        setPadding(0, dp(14), 0, dp(6))
    }

    /**
     * A password field with a Show / Hide toggle inside its right edge.
     *
     * Masked by its transformation method, set AFTER `field()` has made it
     * single-line: `setSingleLine()` installs its own transformation, which
     * silently replaced the password one -- every build before 1.5 showed the
     * token in clear. The input type stays a password type throughout, so the
     * keyboard never learns the token.
     */
    fun secretField(hintText: String): Pair<View, EditText> {
        val edit = field(hintText, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD).apply {
            setPadding(dp(14), dp(12), dp(64), dp(12))
            transformationMethod = PasswordTransformationMethod.getInstance()
            // A password input type switches the field to monospace; the
            // hint must read in the normal face.
            typeface = Typeface.DEFAULT
        }
        val toggle = text("Show", 13f, Palette.ACCENT, bold = true).apply {
            setPadding(dp(14), dp(12), dp(14), dp(12))
            isClickable = true
            setOnClickListener {
                val reveal = edit.transformationMethod is PasswordTransformationMethod
                val at = edit.selectionEnd
                edit.transformationMethod =
                    if (reveal) HideReturnsTransformationMethod.getInstance()
                    else PasswordTransformationMethod.getInstance()
                edit.setSelection(at.coerceAtMost(edit.text.length))
                text = if (reveal) "Hide" else "Show"
            }
        }
        val frame = android.widget.FrameLayout(context).apply {
            addView(edit)
            addView(
                toggle,
                android.widget.FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.END or Gravity.CENTER_VERTICAL),
            )
        }
        return frame to edit
    }

    fun switch(checked: Boolean) = Switch(context).apply {
        isChecked = checked
        val states = arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf())
        thumbTintList = ColorStateList(states, intArrayOf(Palette.ACCENT, 0xFFBDBDC6.toInt()))
        // The framework draws the track at ~30% of this, so the off colour is
        // much lighter than it looks here, or the switch vanishes on the card.
        trackTintList = ColorStateList(states, intArrayOf(Palette.ACCENT, Color.WHITE))
    }

    /* ------------------------------------------------------ list rows */

    /**
     * A status row: a coloured dot, a title, a line under it, and optionally a
     * control at the end. Used for the permission checklist.
     */
    fun statusRow(dotColor: Int, title: String, detail: String, end: View? = null): LinearLayout {
        val row = row().apply { setPadding(0, dp(8), 0, dp(8)) }
        row.addView(dot(dotColor), LinearLayout.LayoutParams(dp(10), dp(10)).apply { rightMargin = dp(14) })
        val texts = column().apply {
            addView(text(title, 15f, Palette.TEXT, bold = true))
            if (detail.isNotEmpty()) {
                addView(text(detail, 13f, Palette.TEXT_DIM).apply { setPadding(0, dp(2), 0, 0) })
            }
        }
        row.addView(texts, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        if (end != null) {
            row.addView(end, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { leftMargin = dp(12) })
        }
        return row
    }

    fun dot(color: Int) = View(context).apply {
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(color)
        }
    }

    /** One label/value pair in the status card's grid. */
    fun stat(label: String): Pair<View, TextView> {
        val value = text("", 15f, Palette.TEXT, bold = true).apply {
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
        }
        val box = column().apply {
            addView(overline(label))
            addView(value.apply { setPadding(0, dp(4), 0, 0) })
        }
        return box to value
    }
}
