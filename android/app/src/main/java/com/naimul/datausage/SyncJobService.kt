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
         * Idempotent: re-registering with the same id REPLACES the existing
         * job, which is also how a settings change takes effect. Calling this
         * from the activity, the settings controls and the boot receiver is
         * therefore all safe and all necessary.
         */
        fun schedule(context: Context) {
            val prefs = Prefs(context)
            val scheduler = context.getSystemService(JobScheduler::class.java)
            val job = JobInfo.Builder(JOB_ID, ComponentName(context, SyncJobService::class.java))
                .setRequiredNetworkType(
                    // ANY still means "some network", not "no constraint" - the
                    // job will not fire offline either way.
                    if (prefs.allowMetered) JobInfo.NETWORK_TYPE_ANY
                    else JobInfo.NETWORK_TYPE_UNMETERED,
                )
                .setPeriodic(prefs.syncHours * 60L * 60L * 1000L)
                .setPersisted(true)
                .build()
            scheduler.schedule(job)
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
        }
    }
}
