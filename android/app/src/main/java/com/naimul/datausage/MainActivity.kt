package com.naimul.datausage

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The whole UI: where to send, what to send with, and whether it is working.
 *
 * Built in code rather than XML, and on the framework theme rather than
 * AppCompat or Material, because the app has no dependencies at all -- see the
 * note in build.gradle.kts. One screen with five controls does not justify
 * bringing a UI toolkit along.
 */
class MainActivity : Activity() {

    private lateinit var prefs: Prefs
    private lateinit var urlField: EditText
    private lateinit var tokenField: EditText
    private lateinit var status: TextView
    private lateinit var intervalGroup: RadioGroup
    private lateinit var meteredBox: CheckBox

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)

        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        root.addView(heading("Data Usage Reporter"))
        root.addView(
            body(
                "Reads Android's own per-app network history and posts it to the " +
                    "dashboard on your PC. Nothing leaves your network, and nothing " +
                    "is stored on the phone.",
            ),
        )

        root.addView(label("Dashboard address"))
        urlField = EditText(this).apply {
            hint = "http://192.168.1.20:7843"
            setText(prefs.serverUrl)
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
        }
        root.addView(urlField)

        root.addView(label("Ingest token"))
        tokenField = EditText(this).apply {
            hint = "ANDROID_INGEST_TOKEN from .env.local"
            setText(prefs.token)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine()
        }
        root.addView(tokenField)

        root.addView(button("Save and test connection") { saveAndTest() })
        root.addView(button("Grant usage access") {
            // Cannot be granted by a runtime prompt; it is a Settings toggle.
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        })
        if (SyncRunner.needsPhoneState) {
            // Only below Android 10. There, reading mobile usage needs each
            // SIM's subscriber id, which is behind this runtime permission; on
            // newer phones the manifest does not even declare it.
            root.addView(button("Grant phone permission (for mobile data)") {
                requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE), REQ_PHONE_STATE)
            })
        }
        root.addView(button("Sync now") { syncNow() })
        root.addView(button("Full resync (re-send everything)") { fullResync() })

        /*
          Background sync settings.

          Worth being clear about what these can and cannot do. Android decides
          when a periodic job actually runs -- it batches them, and App Standby
          throttles apps you rarely open -- so the interval is a REQUEST, not a
          promise. refreshStatus reads back what the system accepted rather
          than echoing what was asked for.
        */
        root.addView(label("Background sync"))
        root.addView(
            body(
                "How often to try. Android batches and throttles background work, " +
                    "so treat this as a request rather than a schedule.",
            ),
        )

        intervalGroup = RadioGroup(this).apply {
            orientation = LinearLayout.HORIZONTAL
            for (h in Prefs.HOUR_CHOICES) {
                addView(
                    RadioButton(this@MainActivity).apply {
                        id = 1000 + h
                        text = if (h == 24) "24h" else "${h}h"
                        setTextColor(Color.LTGRAY)
                    },
                )
            }
            check(1000 + prefs.syncHours)
            setOnCheckedChangeListener { _, id ->
                prefs.syncHours = id - 1000
                // Re-registering with the same job id replaces the old one,
                // which is what makes a change take effect at all.
                SyncJobService.schedule(this@MainActivity)
                refreshStatus()
            }
        }
        root.addView(intervalGroup)

        meteredBox = CheckBox(this).apply {
            text = "Also sync on mobile data"
            setTextColor(Color.LTGRAY)
            isChecked = prefs.allowMetered
            setOnCheckedChangeListener { _, checked ->
                prefs.allowMetered = checked
                SyncJobService.schedule(this@MainActivity)
                refreshStatus()
                if (checked) {
                    toast("A first sync backfills ~90 days. That can be tens of MB.")
                }
            }
        }
        root.addView(meteredBox)
        root.addView(
            body(
                "Off by default: a first sync backfills about 90 days, and sending that " +
                    "over the mobile data this app exists to measure would be a waste of it. " +
                    "Android keeps ~90 days either way, so waiting for Wi-Fi loses nothing.",
            ),
        )

        status = body("").apply { setPadding(0, pad, 0, 0) }
        root.addView(status)

        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PHONE_STATE) refreshStatus()
    }

    private fun save() {
        prefs.serverUrl = urlField.text.toString()
        prefs.token = tokenField.text.toString()
        if (prefs.isConfigured) SyncJobService.schedule(this)
    }

    private fun saveAndTest() {
        save()
        if (!prefs.isConfigured) {
            toast("Enter the address and the token first")
            return
        }
        Thread {
            val result = try {
                Uploader(prefs).test()
            } catch (e: Exception) {
                Uploader.Result(false, e.message ?: "failed", null)
            }
            runOnUiThread {
                toast(if (result.ok) "Connected" else result.message)
                refreshStatus()
            }
        }.start()
    }

    private fun syncNow() {
        save()
        toast("Syncing...")
        Thread {
            val outcome = SyncRunner(applicationContext).runOnce()
            runOnUiThread {
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
    private fun fullResync() {
        prefs.syncedThrough = 0
        toast("Watermark cleared, re-sending everything")
        syncNow()
    }

    private fun refreshStatus() {
        val usageAccess = SyncRunner.hasUsageAccess(this)
        val phoneState = SyncRunner.hasPhoneState(this)
        val granted = usageAccess && phoneState
        val scheduled = SyncJobService.isScheduled(this)
        val through = prefs.syncedThrough
        val fmt = SimpleDateFormat("d MMM yyyy, HH:mm", Locale.getDefault())

        status.text = buildString {
            append(if (usageAccess) "Usage access: granted\n" else "Usage access: NOT GRANTED\n")
            if (SyncRunner.needsPhoneState) {
                append(
                    if (phoneState) "Phone permission: granted\n"
                    else "Phone permission: NOT GRANTED (sync refuses without it)\n",
                )
            }
            if (scheduled) {
                // What the SYSTEM accepted, not what was asked for. Android
                // clamps a periodic job's interval by its own flex rules and by
                // whatever App Standby bucket the app is in, so the two often
                // differ and only the accepted one is true.
                val actual = SyncJobService.scheduledIntervalMs(this@MainActivity)
                val hrs = actual?.let { it / 3_600_000.0 }
                append("Background sync: every ")
                append(
                    if (hrs != null) String.format(Locale.getDefault(), "%.1fh", hrs)
                    else "${prefs.syncHours}h",
                )
                if (hrs != null && kotlin.math.abs(hrs - prefs.syncHours) > 0.1) {
                    append(" (asked for ${prefs.syncHours}h; Android chose this)")
                }
                append(if (prefs.allowMetered) ", any network\n" else ", unmetered only\n")
            } else {
                append("Background sync: not scheduled\n")
            }
            append(
                if (through > 0) "Synced through: ${fmt.format(Date(through))}\n"
                else "Synced through: nothing yet\n",
            )
            if (prefs.lastResult.isNotEmpty()) {
                append("\nLast run ")
                append(fmt.format(Date(prefs.lastResultAt)))
                append("\n")
                append(prefs.lastResult)
            }
        }
        status.setTextColor(if (granted) Color.LTGRAY else Color.parseColor("#ff8a80"))
    }

    /* ------------------------------------------------------------ views */

    private fun heading(text: String) = TextView(this).apply {
        this.text = text
        textSize = 22f
        setTextColor(Color.WHITE)
        setPadding(0, 0, 0, 8)
    }

    private fun label(text: String) = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTextColor(Color.LTGRAY)
        setPadding(0, 24, 0, 4)
    }

    private fun body(text: String) = TextView(this).apply {
        this.text = text
        textSize = 14f
        setTextColor(Color.LTGRAY)
    }

    private fun button(text: String, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
            topMargin = 24
        }
        setOnClickListener { onClick() }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private companion object {
        const val REQ_PHONE_STATE = 1
    }
}
