package com.naimul.datausage

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process

/**
 * One sync, start to finish. Shared by the button and the periodic job so they
 * cannot drift apart.
 */
class SyncRunner(private val context: Context) {

    data class Outcome(val ok: Boolean, val message: String)

    fun runOnce(): Outcome {
        val prefs = Prefs(context)
        if (!prefs.isConfigured) return finish(prefs, false, "Server address and token not set")
        if (!hasUsageAccess(context)) return finish(prefs, false, "Usage access not granted")
        if (!hasPhoneState(context)) return finish(prefs, false, PHONE_STATE_MISSING)

        return try {
            val reader = UsageReader(context)

            /*
              Re-read one bucket BEFORE the watermark, deliberately.

              The newest bucket in any read was almost certainly still filling
              when it was read, so the figure stored for it is partial. Starting
              the next sync exactly at the watermark would leave that partial
              figure in the database forever. Overlapping by one window lets the
              server's MAX() upsert replace it with the complete value, and
              costs one extra bucket per app per sync.
            */
            val from = if (prefs.syncedThrough > 0) {
                prefs.syncedThrough - TWO_HOURS
            } else {
                // First run: take everything Android still holds. AOSP deletes
                // per-uid history at 90 days, so asking for more is harmless.
                System.currentTimeMillis() - 95L * 24 * 60 * 60 * 1000
            }

            val buckets = reader.read(from)
            if (buckets.isEmpty()) return finish(prefs, true, "Nothing new to send")

            val result = Uploader(prefs).upload(buckets, reader.apps())
            if (result.ok && result.acceptedThrough != null) {
                // Advance from what the SERVER confirmed, never from what was
                // sent. An upload that fails halfway must be retried, not
                // skipped past.
                prefs.syncedThrough = result.acceptedThrough
            }
            finish(prefs, result.ok, result.message)
        } catch (e: UsageReader.UsageAccessDenied) {
            finish(prefs, false, "Usage access was revoked")
        } catch (e: UsageReader.PhoneStateDenied) {
            finish(prefs, false, PHONE_STATE_MISSING)
        } catch (e: Exception) {
            finish(prefs, false, e.message ?: e.javaClass.simpleName)
        }
    }

    private fun finish(prefs: Prefs, ok: Boolean, message: String): Outcome {
        prefs.lastResult = (if (ok) "OK - " else "Failed - ") + message
        prefs.lastResultAt = System.currentTimeMillis()
        return Outcome(ok, message)
    }

    companion object {
        private const val TWO_HOURS = 2 * 60 * 60 * 1000L

        private const val PHONE_STATE_MISSING =
            "Phone permission not granted (needed to read mobile data on Android 9 and older)"

        /**
         * Whether this Android version needs READ_PHONE_STATE to read mobile
         * usage at all. Below API 29 it does -- see
         * `UsageReader.mobileSubscriberIds` for why a null subscriber id is not
         * an option there.
         */
        val needsPhoneState: Boolean
            get() = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q

        /** True when it is either granted or not needed on this version. */
        fun hasPhoneState(context: Context): Boolean =
            !needsPhoneState ||
                context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) ==
                PackageManager.PERMISSION_GRANTED

        /**
         * Whether PACKAGE_USAGE_STATS has actually been granted.
         *
         * It is an appop, not a runtime permission: `checkSelfPermission` says
         * "granted" as soon as it is in the manifest, whether or not the user
         * has switched it on. Asking AppOpsManager is the only honest check,
         * and getting this wrong means the app silently reports only its own
         * traffic and looks like it is working.
         */
        fun hasUsageAccess(context: Context): Boolean {
            val ops = context.getSystemService(AppOpsManager::class.java)
            // Same question, renamed in API 29: `checkOpNoThrow` was deprecated
            // for `unsafeCheckOpNoThrow`, which does not exist on older phones.
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ops.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName,
                )
            } else {
                @Suppress("DEPRECATION")
                ops.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName,
                )
            }
            return mode == AppOpsManager.MODE_ALLOWED
        }
    }
}
