package com.naimul.datausage

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.util.Log

/**
 * The periodic upload.
 *
 * JobScheduler rather than WorkManager: it is framework, so the app has no
 * dependencies at all, and it already does the two things needed -- run on a
 * schedule, only on an unmetered network, and survive a reboot.
 *
 * **Cadence is generous on purpose.** Android retains ~90 days of per-uid
 * history (57 measured on this device), so the phone only has to be seen
 * before that window closes, not promptly. Six hours means a phone that is on
 * home Wi-Fi at any point in a day will report, and one that is away for a
 * fortnight loses nothing when it comes back. The same "collect faster than
 * eviction, not faster than writing" rule as the Windows collector.
 */
class SyncJobService : JobService() {

    override fun onStartJob(params: JobParameters?): Boolean {
        // JobService callbacks run on the main thread; the read can span
        // hundreds of querySummary calls on a first backfill.
        Thread {
            val result = SyncRunner(applicationContext).runOnce()
            Log.i(TAG, "sync: ${result.message}")
            // Never reschedule on failure: the job is periodic, so the next run
            // is already booked, and a retry storm on a phone that simply is
            // not on the right network wastes battery for nothing.
            jobFinished(params, false)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters?): Boolean = true

    companion object {
        private const val TAG = "DataUsageSync"
        private const val JOB_ID = 4711

        /**
         * Books the job, or re-books it when its settings changed. Calling this
         * from the activity, the settings controls and the boot receiver is
         * therefore all safe and all necessary.
         *
         * **An unchanged job is left alone.** Re-registering a periodic job
         * makes it due at once, so a Sync now press -- which saves the settings
         * first -- started this job's sync beside the button's own, and both
         * sent the same window. About a quarter of uploads (2026-10-15) arrived
         * as a second or third copy within 5 s. A settings change still re-books
         * it, and runs a sync then, which is fine.
         */
        fun schedule(context: Context) {
            val prefs = Prefs(context)
            val scheduler = context.getSystemService(JobScheduler::class.java)
            // ANY still means "some network", not "no constraint" - the job
            // will not fire offline either way.
            val network = if (prefs.allowMetered) JobInfo.NETWORK_TYPE_ANY else JobInfo.NETWORK_TYPE_UNMETERED
            val interval = prefs.syncHours * 60L * 60L * 1000L
            if (!isBooked(scheduler.getPendingJob(JOB_ID), interval, network)) {
                val job = JobInfo.Builder(JOB_ID, ComponentName(context, SyncJobService::class.java))
                    .setRequiredNetworkType(network)
                    .setPeriodic(interval)
                    .setPersisted(true)
                    .build()
                scheduler.schedule(job)
            }
            // Every caller that books the sync also wants it watched.
            SyncWatch.schedule(context)
        }

        /**
         * Whether [pending] is already the job [schedule] would book. Any
         * doubt counts as "no", which re-books it: the old behaviour, never a
         * missing job.
         */
        private fun isBooked(pending: JobInfo?, interval: Long, network: Int): Boolean {
            if (pending == null || !pending.isPeriodic || !pending.isPersisted) return false
            // Deprecated in API 28 for getRequiredNetwork(), and still derived
            // from it there; it is the one accessor every minSdk has.
            @Suppress("DEPRECATION")
            return pending.intervalMillis == interval && pending.networkType == network
        }

        /**
         * What the system actually accepted.
         *
         * Android silently clamps a periodic job's interval - by its own
         * flex/throttling rules and by whatever App Standby bucket the app is
         * in - so what was requested and what is scheduled can differ. Reading
         * it back is the only honest thing to show.
         */
        fun scheduledIntervalMs(context: Context): Long? =
            context.getSystemService(JobScheduler::class.java)
                .allPendingJobs.firstOrNull { it.id == JOB_ID }?.intervalMillis

        fun isScheduled(context: Context): Boolean =
            context.getSystemService(JobScheduler::class.java)
                .allPendingJobs.any { it.id == JOB_ID }

        fun cancel(context: Context) {
            context.getSystemService(JobScheduler::class.java).cancel(JOB_ID)
            SyncWatch.cancel(context)
        }
    }
}
