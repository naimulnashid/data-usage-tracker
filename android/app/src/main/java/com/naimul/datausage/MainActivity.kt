package com.naimul.datausage

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.text.format.DateUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The whole UI: whether it is working, where to send, and how often.
 *
 * Built in code rather than XML, and on the framework theme rather than
 * AppCompat or Material Components, because the app has no dependencies at
 * all -- see the note in build.gradle.kts. The look lives in Ui.kt.
 *
 * Laid out in the order a person asks the questions: is it working (the
 * status card), is anything missing (permissions), where does it send
 * (connection, cloud inbox), how often (background sync), and the one rare
 * repair (full resync) last.
 */
class MainActivity : Activity() {

    private lateinit var prefs: Prefs
    private lateinit var ui: Ui

    private lateinit var content: LinearLayout
    private lateinit var urlField: EditText
    private lateinit var tokenField: EditText

    // Status card
    private lateinit var statusDot: View
    private lateinit var statusTitle: TextView
    private lateinit var statusDetail: TextView
    private lateinit var statThrough: TextView
    private lateinit var statSendsTo: TextView
    private lateinit var statSchedule: TextView
    private lateinit var statLastRun: TextView
    private lateinit var syncButton: TextView

    // Cards whose contents change with state
    private lateinit var permissions: Ui.Card
    private lateinit var inboxBadge: TextView
    private lateinit var inboxText: TextView
    private lateinit var inboxActions: LinearLayout
    private lateinit var connection: Ui.Card

    private val chips = mutableMapOf<Int, TextView>()
    private lateinit var meteredSwitch: Switch

    private lateinit var statusScrim: View

    private var syncing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        ui = Ui(this)

        content = ui.column().apply { setPadding(ui.dp(16), ui.dp(16), ui.dp(16), ui.dp(16)) }

        content.addView(header())
        content.addView(statusCard())
        permissions = ui.card("Permissions")
        content.addView(permissions.view)
        content.addView(connectionCard())
        content.addView(inboxCard())
        content.addView(scheduleCard())
        content.addView(repairCard())

        val scroll = ScrollView(this).apply {
            setBackgroundColor(Palette.BG)
            isFillViewport = true
            addView(content)
        }
        // Content scrolls under a transparent status bar, so the bar gets a
        // scrim of its own; sized to the inset in drawEdgeToEdge.
        statusScrim = View(this).apply { setBackgroundColor(0xF2000000.toInt()) }
        setContentView(
            android.widget.FrameLayout(this).apply {
                addView(scroll)
                addView(statusScrim, android.widget.FrameLayout.LayoutParams(MATCH_PARENT, 0))
            },
        )
        drawEdgeToEdge(scroll)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !SyncWatch.notificationsAllowed(this) && savedInstanceState == null
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
        }
        // Books the watch for installs upgraded from 1.3, whose sync job was
        // registered before the watch existed.
        if (prefs.isConfigured) SyncWatch.schedule(this)
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PHONE_STATE || requestCode == REQ_NOTIFY) refreshStatus()
    }

    /**
     * Draw under the status and navigation bars and pad the content by them.
     *
     * targetSdk 36 makes this the only behaviour on Android 15 and later, so
     * it is done on every version to look the same everywhere -- and the
     * padding has to come from the insets, or the title sits under the clock.
     * The keyboard is part of the bottom inset, so a focused field scrolls
     * clear of it.
     */
    private fun drawEdgeToEdge(scroll: ScrollView) {
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
        val pad = ui.dp(16)
        scroll.setOnApplyWindowInsetsListener { _, insets ->
            val top: Int
            val bottom: Int
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                top = bars.top
                bottom = bars.bottom
            } else {
                @Suppress("DEPRECATION")
                top = insets.systemWindowInsetTop
                @Suppress("DEPRECATION")
                bottom = insets.systemWindowInsetBottom
            }
            content.setPadding(pad, pad + top, pad, pad + bottom)
            statusScrim.layoutParams = statusScrim.layoutParams.apply { height = top }
            insets
        }
    }

    /* ---------------------------------------------------------- sections */

    private fun header(): View = ui.row().apply {
        setPadding(ui.dp(4), ui.dp(8), ui.dp(4), ui.dp(6))
        addView(
            ui.text("Data Usage Reporter", 24f, Palette.TEXT, bold = true),
            LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f),
        )
        addView(ui.text("v${BuildConfig.VERSION_NAME}", 13f, Palette.TEXT_FAINT))
    }

    private fun statusCard(): View {
        val card = ui.column().apply {
            background = ui.rounded(Palette.CARD, 22, 1, Palette.CARD_BORDER)
            setPadding(ui.dp(20), ui.dp(20), ui.dp(20), ui.dp(20))
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = ui.dp(10) }
        }

        val headline = ui.row()
        statusDot = ui.dot(Palette.TEXT_FAINT)
        headline.addView(statusDot, LinearLayout.LayoutParams(ui.dp(12), ui.dp(12)).apply { rightMargin = ui.dp(12) })
        statusTitle = ui.text("", 22f, Palette.TEXT, bold = true)
        headline.addView(statusTitle, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        card.addView(headline)

        statusDetail = ui.text("", 14f, Palette.TEXT_DIM).apply { setPadding(0, ui.dp(8), 0, 0) }
        card.addView(statusDetail)

        card.addView(ui.divider())
        val (through, throughValue) = ui.stat("Data through")
        val (sendsTo, sendsToValue) = ui.stat("Sends to")
        val (schedule, scheduleValue) = ui.stat("Background")
        val (lastRun, lastRunValue) = ui.stat("Last attempt")
        statThrough = throughValue
        statSendsTo = sendsToValue
        statSchedule = scheduleValue
        statLastRun = lastRunValue
        card.addView(pair(through, sendsTo))
        card.addView(ui.gap(14))
        card.addView(pair(schedule, lastRun))

        syncButton = ui.button("Sync now", Ui.Kind.PRIMARY) { syncNow() }.apply {
            (layoutParams as LinearLayout.LayoutParams).topMargin = ui.dp(20)
        }
        card.addView(syncButton)
        return card
    }

    private fun pair(a: View, b: View): View = ui.row().apply {
        gravity = Gravity.TOP
        addView(a, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { rightMargin = ui.dp(12) })
        addView(b, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
    }

    private fun connectionCard(): View {
        connection = ui.card("Dashboard")
        val body = connection.body

        body.addView(ui.fieldLabel("Address").apply { setPadding(0, 0, 0, ui.dp(6)) })
        urlField = ui.field(ServerAddress.EXAMPLE, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
            .apply { setText(prefs.serverUrl) }
        body.addView(urlField)

        body.addView(ui.fieldLabel("Ingest token"))
        val (tokenBox, token) = ui.secretField("From .env.local on the PC")
        tokenField = token.apply { setText(prefs.token) }
        body.addView(tokenBox)

        body.addView(
            ui.button("Save and test connection") { saveAndTest() }.apply {
                (layoutParams as LinearLayout.LayoutParams).topMargin = ui.dp(16)
            },
        )
        return connection.view
    }

    /*
      The cloud inbox. Once on, uploads go to a fixed https address that works
      from any network and while the PC is off, sealed to a key only the PC
      holds. The dashboard address is then only used to set it up: the inbox
      address and the key both come from the dashboard, over the LAN, in one
      tap.
    */
    private fun inboxCard(): View {
        val card = ui.card("Cloud inbox")
        val title = card.view.getChildAt(0)
        card.view.removeViewAt(0)
        val top = ui.row()
        top.addView(title, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        inboxBadge = ui.badge("", Palette.TEXT, Palette.INPUT)
        top.addView(inboxBadge)
        card.view.addView(top, 0)

        inboxText = ui.text("", 13.5f, Palette.TEXT_DIM)
        card.body.addView(inboxText)
        inboxActions = ui.column()
        card.body.addView(inboxActions)
        return card.view
    }

    private fun scheduleCard(): View {
        // Android batches and throttles background work, so the interval is a
        // request; the status card shows what the system accepted.
        val card = ui.card("Background sync")
        val chipRow = ui.row()
        for ((i, h) in Prefs.HOUR_CHOICES.withIndex()) {
            val chip = ui.text(if (h == 24) "Daily" else "${h}h", 14f, Palette.TEXT, bold = true).apply {
                gravity = Gravity.CENTER
                setPadding(0, ui.dp(10), 0, ui.dp(10))
                isClickable = true
                setOnClickListener {
                    prefs.syncHours = h
                    // Re-registering with the same job id replaces the old
                    // one, which is what makes a change take effect at all.
                    SyncJobService.schedule(this@MainActivity)
                    refreshStatus()
                }
            }
            chips[h] = chip
            chipRow.addView(
                chip,
                LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { if (i > 0) leftMargin = ui.dp(8) },
            )
        }
        card.body.addView(chipRow)

        card.body.addView(ui.divider())
        val meteredRow = ui.row()
        // Off by default: a first sync sends ~90 days, and spending the mobile
        // data this app measures on that would be a waste. Wi-Fi loses nothing.
        meteredRow.addView(
            ui.text("Also on mobile data", 15f, Palette.TEXT, bold = true),
            LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { rightMargin = ui.dp(12) },
        )
        meteredSwitch = ui.switch(prefs.allowMetered).apply {
            setOnCheckedChangeListener { _, checked ->
                if (checked == prefs.allowMetered) return@setOnCheckedChangeListener
                prefs.allowMetered = checked
                SyncJobService.schedule(this@MainActivity)
                refreshStatus()
                if (checked) toast("A first sync backfills ~90 days. That can be tens of MB.")
            }
        }
        meteredRow.addView(meteredSwitch)
        card.body.addView(meteredRow)
        return card.view
    }

    private fun repairCard(): View {
        val card = ui.card("Full resync")
        card.body.addView(
            ui.button("Re-send everything", Ui.Kind.SECONDARY) { confirmFullResync() }.apply {
                (layoutParams as LinearLayout.LayoutParams).topMargin = 0
            },
        )
        card.body.addView(
            ui.text("Phone id ${prefs.deviceId.take(8)}", 12.5f, Palette.TEXT_FAINT).apply {
                setPadding(0, ui.dp(12), 0, 0)
            },
        )
        return card.view
    }

    /* ------------------------------------------------------------ actions */

    /**
     * Saves the fields, unless the address is malformed: then it is NOT saved,
     * and the problem is shown on the field itself. Keeping the last good
     * address means a typo cannot take a working phone offline.
     */
    private fun save(): Boolean {
        prefs.token = tokenField.text.toString()
        val problem = addressProblem()
        if (problem != null) {
            urlField.error = problem
            urlField.requestFocus()
            toast(problem)
            return false
        }
        urlField.error = null
        prefs.serverUrl = urlField.text.toString()
        if (prefs.isConfigured) SyncJobService.schedule(this)
        return true
    }

    /**
     * With the cloud inbox on, the dashboard address is only needed to set the
     * inbox up again, so an empty one is fine; a malformed one still is not.
     */
    private fun addressProblem(): String? {
        val raw = urlField.text.toString()
        return if (prefs.usesInbox && raw.isBlank()) null else ServerAddress.problem(raw)
    }

    private fun setUpInbox() {
        if (!save()) return
        if (prefs.serverUrl.isEmpty() || prefs.token.isEmpty()) {
            toast("Enter the dashboard address and token first. The phone must be on the same network as the PC.")
            return
        }
        toast("Asking the dashboard...")
        Thread {
            val message = try {
                val setup = Uploader(prefs).fetchInboxSetup()
                // Computed here from the key itself and compared with the
                // dashboard's, so a key garbled in transit is never saved.
                val fp = Sealer.fingerprint(setup.publicKey)
                check(fp == setup.fingerprint) { "The PC key arrived damaged. Try again." }
                prefs.inboxUrl = setup.url
                prefs.inboxKey = setup.publicKey
                SyncJobService.schedule(this)
                val test = Uploader(prefs).test()
                if (test.ok) "Cloud inbox on. PC key $fp"
                else "Cloud inbox saved, but the test failed: ${test.message}"
            } catch (e: Exception) {
                e.message ?: e.javaClass.simpleName
            }
            runOnUiThread {
                toast(message)
                refreshStatus()
            }
        }.start()
    }

    private fun confirmTurnOffInbox() {
        AlertDialog.Builder(this)
            .setTitle("Turn off the cloud inbox?")
            .setMessage("Uploads will go to the dashboard address again.")
            .setPositiveButton("Turn off") { _, _ ->
                prefs.inboxUrl = ""
                prefs.inboxKey = ""
                toast("Cloud inbox off")
                refreshStatus()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun saveAndTest() {
        if (!save()) return
        if (!prefs.isConfigured) {
            toast("Enter the token first")
            return
        }
        Thread {
            val result = try {
                Uploader(prefs).test()
            } catch (e: Exception) {
                Uploader.Result(false, e.message ?: "failed", null)
            }
            val hint = if (result.ok) null else ServerAddress.failureHint(prefs.serverUrl)
            runOnUiThread {
                toast(if (result.ok) "Connected" else listOfNotNull(result.message, hint).joinToString("\n"))
                refreshStatus()
            }
        }.start()
    }

    private fun syncNow() {
        if (syncing || !save()) return
        syncing = true
        refreshStatus()
        Thread {
            val outcome = SyncRunner(applicationContext).runOnce()
            runOnUiThread {
                syncing = false
                toast(outcome.message)
                refreshStatus()
            }
        }.start()
    }

    /**
     * Forget the watermark and re-send every bucket Android still holds.
     *
     * Needed whenever the SERVER's copy is not what the phone assumes: the
     * database restored from backup, rows deleted, or -- as happened here -- a
     * bug fixed in how buckets are read, where the corrected figures only reach
     * the server if the history is sent again. The server's MAX() upsert makes
     * this safe to press at any time: nothing is duplicated, and a corrected
     * larger value replaces a smaller one.
     */
    private fun confirmFullResync() {
        if (addressProblem() != null) {
            syncNow() // shows the problem, keeps the watermark
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Re-send everything?")
            .setMessage("About 90 days of history, possibly tens of MB.")
            .setPositiveButton("Re-send") { _, _ ->
                prefs.syncedThrough = 0
                syncNow()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /* ------------------------------------------------------------- state */

    private fun refreshStatus() {
        val usageAccess = SyncRunner.hasUsageAccess(this)
        val phoneState = SyncRunner.hasPhoneState(this)
        val alerts = SyncWatch.notificationsAllowed(this)
        val fmt = SimpleDateFormat("d MMM, HH:mm", Locale.getDefault())
        val now = System.currentTimeMillis()

        /* The headline: one answer to "is it working?" */
        val lastOk = prefs.lastSuccessAt
        val lastFailed = prefs.lastResult.startsWith("Failed")
        val (color, title, detail) = when {
            syncing -> Triple(Palette.ACCENT, "Syncing…", "")
            !prefs.isConfigured -> Triple(Palette.TEXT_FAINT, "Not set up yet", "")
            !usageAccess -> Triple(Palette.BAD, "Usage access is off", "")
            !phoneState -> Triple(Palette.BAD, "Phone permission needed", "")
            // The one detail worth showing: what went wrong.
            lastFailed -> Triple(Palette.BAD, "Last sync failed", prefs.lastResult.removePrefix("Failed - "))
            lastOk == 0L -> Triple(Palette.WARN, "No sync yet", "")
            // Amber after three days; Android keeps ~90, so nothing is lost yet.
            now - lastOk > STALE_MS -> Triple(Palette.WARN, "Synced ${relative(lastOk)}", "")
            else -> Triple(Palette.ACCENT, "Synced ${relative(lastOk)}", "")
        }
        (statusDot.background as android.graphics.drawable.GradientDrawable).setColor(color)
        statusTitle.text = title
        statusDetail.text = detail
        statusDetail.visibility = if (detail.isEmpty()) View.GONE else View.VISIBLE

        statThrough.text = if (prefs.syncedThrough > 0) fmt.format(Date(prefs.syncedThrough)) else "Nothing yet"
        statSendsTo.text = when {
            prefs.usesInbox -> "Cloud inbox"
            prefs.serverUrl.isNotEmpty() -> "PC, on this network"
            else -> "Not set"
        }
        statSchedule.text = scheduleText()
        statLastRun.text = if (prefs.lastResultAt > 0) relative(prefs.lastResultAt) else "Never"
        syncButton.text = if (syncing) "Syncing…" else "Sync now"
        syncButton.alpha = if (syncing) 0.6f else 1f

        /* Permissions: shown only while something is missing, with the fix. */
        permissions.body.removeAllViews()
        permissions.view.visibility =
            if (usageAccess && phoneState && (alerts || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU)) View.GONE
            else View.VISIBLE
        permissions.body.addView(
            ui.statusRow(
                if (usageAccess) Palette.ACCENT else Palette.BAD,
                "Usage access",
                if (usageAccess) "" else "Required",
                if (usageAccess) null else ui.smallButton("Grant") {
                    startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
                },
            ),
        )
        if (SyncRunner.needsPhoneState) {
            // Only below Android 10. There, reading mobile usage needs each
            // SIM's subscriber id, which is behind this runtime permission.
            permissions.body.addView(
                ui.statusRow(
                    if (phoneState) Palette.ACCENT else Palette.BAD,
                    "Phone permission",
                    if (phoneState) "" else "Needed for mobile data",
                    if (phoneState) null else ui.smallButton("Grant") {
                        requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE), REQ_PHONE_STATE)
                    },
                ),
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // The only notification this app posts is the week-without-a-sync alert.
            permissions.body.addView(
                ui.statusRow(
                    if (alerts) Palette.ACCENT else Palette.WARN,
                    "Sync alerts",
                    if (alerts) "" else "Off",
                    if (alerts) null else ui.smallButton("Allow") {
                        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
                    },
                ),
            )
        }

        /* Connection and inbox */
        refreshInbox()

        /* Schedule */
        for ((h, chip) in chips) {
            val on = h == prefs.syncHours
            chip.setTextColor(if (on) Palette.ON_ACCENT else Palette.TEXT_DIM)
            chip.background = if (on) ui.rounded(Palette.ACCENT, 12)
            else ui.rounded(Palette.INPUT, 12, 1, Palette.INPUT_BORDER)
        }
        if (meteredSwitch.isChecked != prefs.allowMetered) meteredSwitch.isChecked = prefs.allowMetered
    }

    private fun refreshInbox() {
        inboxActions.removeAllViews()
        if (prefs.usesInbox) {
            inboxBadge.text = "On"
            inboxBadge.setTextColor(Palette.ACCENT_BRIGHT)
            inboxBadge.background = ui.rounded(Palette.ACCENT_DIM, 999)
            inboxText.text = "PC key ${Sealer.fingerprint(prefs.inboxKey)}"
            inboxActions.addView(ui.button("Set up again", Ui.Kind.SECONDARY) { setUpInbox() })
            inboxActions.addView(
                ui.button("Turn off", Ui.Kind.DANGER) { confirmTurnOffInbox() }.apply {
                    (layoutParams as LinearLayout.LayoutParams).topMargin = ui.dp(4)
                },
            )
        } else {
            inboxBadge.text = "Off"
            inboxBadge.setTextColor(Palette.TEXT_DIM)
            inboxBadge.background = ui.rounded(Palette.INPUT, 999)
            inboxText.text = "Sync from anywhere, even with the PC off."
            inboxActions.addView(ui.button("Set up from the dashboard", Ui.Kind.SECONDARY) { setUpInbox() })
        }
    }

    /** What the system accepted, not what was asked for. */
    private fun scheduleText(): String {
        if (!SyncJobService.isScheduled(this)) return "Not scheduled"
        // Android clamps a periodic job's interval by its own flex rules and
        // by the app's standby bucket, so only the accepted value is true.
        val hours = SyncJobService.scheduledIntervalMs(this)?.let { it / 3_600_000.0 }
            ?: prefs.syncHours.toDouble()
        val every = if (hours == hours.toLong().toDouble()) "${hours.toLong()}h"
        else String.format(Locale.getDefault(), "%.1fh", hours)
        return "Every $every · ${if (prefs.allowMetered) "any network" else "Wi-Fi only"}"
    }

    private fun relative(at: Long): String =
        DateUtils.getRelativeTimeSpanString(at, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()
            .let { if (it == "0 minutes ago" || it == "In 0 minutes") "just now" else it }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private companion object {
        const val REQ_PHONE_STATE = 1
        const val REQ_NOTIFY = 2

        /** The dashboard's SYNC_WARN_HOURS: amber after three days. */
        const val STALE_MS = 72L * 60 * 60 * 1000
    }
}
