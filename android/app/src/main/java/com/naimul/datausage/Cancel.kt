package com.naimul.datausage

import java.net.HttpURLConnection

/**
 * A stop signal for one sync, set by [SyncJobService.onStopJob].
 *
 * JobScheduler stops a job when its constraints lapse -- the unmetered
 * network went away -- or its time is up, and expects the work to stop with
 * it. Returning from onStopJob did not do that: the thread went on reading
 * and then uploading on whatever network it now had. The read checks this
 * between windows, and an upload in flight is disconnected, which fails it
 * before the watermark moves; the next sync sends the same window again,
 * which the server's MAX() upsert makes harmless.
 */
class Cancel {
    @Volatile
    var cancelled = false
        private set

    @Volatile
    private var connection: HttpURLConnection? = null

    fun cancel() {
        cancelled = true
        connection?.disconnect()
    }

    /** Throws [SyncRunner.Cancelled] once stopped. */
    fun check() {
        if (cancelled) throw SyncRunner.Cancelled()
    }

    /** The upload in flight, to disconnect on [cancel]; null when it ends. */
    fun track(conn: HttpURLConnection?) {
        connection = conn
        if (conn != null && cancelled) conn.disconnect()
    }
}
