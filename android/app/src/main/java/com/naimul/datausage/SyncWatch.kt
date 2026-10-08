package com.naimul.datausage

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * Warns when the phone has not synced successfully for a week.
 *
 * Android keeps ~90 days of per-uid history, so a week without a sync loses
 * nothing yet. The point is to say so while there is still most of that window
 * left to fix whatever broke: a changed dashboard address, a rotated token,
 * usage access switched off, or a phone that simply never sees home Wi-Fi.
 *
 * **The check is its own job, with no network constraint.** The sync job only
 * runs on an unmetered network, so the one failure it can never report is the
 * commonest: never being on one. A check living inside it would go quiet in
 * exactly the case it exists for.
 */
object SyncWatch {

    const val STALE_AFTER_MS = 7L * 24 * 60 * 60 * 1000

    /** While still stale, say it again at most this often. */
    private const val REPEAT_MS = 24L * 60 * 60 * 1000

    private const val CHECK_EVERY_MS = 12L * 60 * 60 * 1000
    private const val JOB_ID = 4712
    private const val CHANNEL_ID = "sync-stale"
    private const val NOTIFICATION_ID = 1

    /** Called after every sync attempt, from the button and the job alike. */
    fun onSyncFinished(context: Context, ok: Boolean) {
        val prefs = Prefs(context)
        if (ok) {
            prefs.lastSuccessAt = System.currentTimeMillis()
            prefs.lastAlertAt = 0L
            context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
        } else {
            check(context)
        }
    }

    fun check(context: Context) {
        val prefs = Prefs(context)
        // Not set up yet is not "stopped syncing": nothing was ever promised.
        if (!prefs.isConfigured) return

        val now = System.currentTimeMillis()
        val since = staleSince(prefs, now)
        if (now - since < STALE_AFTER_MS) return
        if (now - prefs.lastAlertAt < REPEAT_MS) return

        val days = (now - since) / (24L * 60 * 60 * 1000)
        val text = buildString {
            append("Android keeps about 90 days of history; anything older than that ")
            append("is gone for good. Open the app to see what is failing.")
            if (prefs.lastResult.isNotEmpty()) append("\n\nLast run: ").append(prefs.lastResult)
        }
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sync)
            .setContentTitle(
                if (prefs.lastSuccessAt > 0) "No successful sync for $days days"
                else "No successful sync yet, $days days after setup",
            )
            .setContentText("Android keeps about 90 days of history. Tap to check.")
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()

        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Sync stopped", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "When the phone has not reached the dashboard for a week"
            },
        )
        // Denied on Android 13+ means the alert is silently dropped; the app's
        // status screen says so instead (notificationsAllowed).
        if (!notificationsAllowed(context)) return
        nm.notify(NOTIFICATION_ID, notification)
        prefs.lastAlertAt = now
    }

    /**
     * The instant the staleness clock started.
     *
     * The last success when there is one. Builds before 1.4 never recorded it,
     * so an upgraded install borrows the last run's time when that run worked,
     * and otherwise starts the clock at the first check -- late rather than
     * an alert on the very first day after upgrading.
     */
    private fun staleSince(prefs: Prefs, now: Long): Long {
        if (prefs.lastSuccessAt > 0) return prefs.lastSuccessAt
        if (prefs.lastResult.startsWith("OK") && prefs.lastResultAt > 0) {
            return prefs.lastResultAt.also { prefs.lastSuccessAt = it }
        }
        if (prefs.watchSince == 0L) prefs.watchSince = now
        return prefs.watchSince
    }

    fun notificationsAllowed(context: Context): Boolean =
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED) &&
            context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    /**
     * Books the twice-daily check, unless it is already booked: re-registering
     * a periodic job restarts its clock, and the app calls this on every
     * launch. Nothing about the job is configurable, so there is never a
     * reason to replace it.
     */
    fun schedule(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java)
        if (scheduler.allPendingJobs.any { it.id == JOB_ID }) return
        val job = JobInfo.Builder(JOB_ID, ComponentName(context, SyncWatchJobService::class.java))
            .setPeriodic(CHECK_EVERY_MS)
            .setPersisted(true)
            .build()
        scheduler.schedule(job)
    }

    fun cancel(context: Context) {
        context.getSystemService(JobScheduler::class.java).cancel(JOB_ID)
    }
}

/** Runs [SyncWatch.check] twice a day, on any network or none. */
class SyncWatchJobService : JobService() {
    override fun onStartJob(params: JobParameters?): Boolean {
        SyncWatch.check(applicationContext)
        return false
    }

    override fun onStopJob(params: JobParameters?): Boolean = false
}
