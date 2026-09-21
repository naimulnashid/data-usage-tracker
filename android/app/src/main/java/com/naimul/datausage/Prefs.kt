package com.naimul.datausage

import android.content.Context
import java.util.UUID

/**
 * Everything the app remembers, which is deliberately very little.
 *
 * No usage data is stored on the phone. Android already keeps ~90 days of it
 * and this app's job is to move it, not to hold a second copy.
 */
class Prefs(context: Context) {

    private val sp = context.getSharedPreferences("data-usage", Context.MODE_PRIVATE)

    /**
     * A random id generated once, on first launch.
     *
     * NOT the hardware serial, ANDROID_ID or an advertising id. Those are
     * either unavailable without extra permissions or are identifiers this
     * project has no business holding; all the dashboard needs is something
     * stable enough to tell two phones apart.
     */
    val deviceId: String
        get() = sp.getString(KEY_DEVICE_ID, null) ?: UUID.randomUUID().toString().also {
            sp.edit().putString(KEY_DEVICE_ID, it).apply()
        }

    var serverUrl: String
        get() = sp.getString(KEY_URL, "") ?: ""
        set(v) = sp.edit().putString(KEY_URL, v.trim().trimEnd('/')).apply()

    var token: String
        get() = sp.getString(KEY_TOKEN, "") ?: ""
        set(v) = sp.edit().putString(KEY_TOKEN, v.trim()).apply()

    /**
     * Epoch ms of the newest bucket the SERVER confirmed it stored.
     *
     * Advanced from the response, never from what was sent: a upload that fails
     * halfway must be retried, not skipped. Buckets are re-sent from one window
     * before this, because the most recent bucket was probably still filling
     * when it was read and its later, larger reading has to overwrite it.
     */
    var syncedThrough: Long
        get() = sp.getLong(KEY_THROUGH, 0L)
        set(v) = sp.edit().putLong(KEY_THROUGH, v).apply()

    /**
     * How often the background job runs, in hours.
     *
     * JobScheduler's floor for a periodic job is 15 minutes, but nothing here
     * benefits from being that eager: Android writes 2-hour buckets and keeps
     * ~90 days, so the job only has to beat eviction. The choices offered are
     * whole hours for that reason.
     */
    var syncHours: Int
        get() = sp.getInt(KEY_HOURS, DEFAULT_HOURS)
        set(v) = sp.edit().putInt(KEY_HOURS, v).apply()

    /**
     * Whether the job may run on a metered connection.
     *
     * Off by default, and the default matters: a first sync backfills ~90 days,
     * and doing that over the mobile data this app exists to measure would be a
     * self-inflicted wound.
     */
    var allowMetered: Boolean
        get() = sp.getBoolean(KEY_METERED, false)
        set(v) = sp.edit().putBoolean(KEY_METERED, v).apply()

    var lastResult: String
        get() = sp.getString(KEY_RESULT, "") ?: ""
        set(v) = sp.edit().putString(KEY_RESULT, v).apply()

    var lastResultAt: Long
        get() = sp.getLong(KEY_RESULT_AT, 0L)
        set(v) = sp.edit().putLong(KEY_RESULT_AT, v).apply()

    val isConfigured: Boolean
        get() = serverUrl.isNotEmpty() && token.isNotEmpty()

    companion object {
        const val DEFAULT_HOURS = 6

        /** Offered in the app. Whole hours; see syncHours. */
        val HOUR_CHOICES = intArrayOf(1, 3, 6, 12, 24)

        private const val KEY_HOURS = "sync_hours"
        private const val KEY_METERED = "allow_metered"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_URL = "server_url"
        const val KEY_TOKEN = "token"
        const val KEY_THROUGH = "synced_through"
        const val KEY_RESULT = "last_result"
        const val KEY_RESULT_AT = "last_result_at"
    }
}
