package com.naimul.datausage

import android.app.usage.NetworkStats
import android.app.usage.NetworkStatsManager
import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.os.Build
import android.os.RemoteException
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager

/**
 * Reading per-app usage out of Android.
 *
 * Two decisions here carry the correctness of the whole Android half.
 *
 * ## 1. querySummary, not queryDetails
 *
 * `queryDetails` returns time-bucketed rows in one call and is far cheaper, but
 * its rows carry BOTH tagged and untagged entries and a separate row per
 * process state. Tagged entries are a subset of the untagged total and the
 * states are slices of one figure, so summing what it returns double-counts,
 * twice over, in two different ways.
 *
 * `querySummary` collapses tag and state for us -- every bucket it returns is
 * STATE_ALL and TAG_NONE -- at the cost of returning one row per uid for the
 * WHOLE window rather than per time bucket. So it is called once per 2-hour
 * window instead. A first backfill of 90 days is ~1,080 calls per network type;
 * every sync after that covers hours.
 *
 * The trade is deliberate: this side of the project has already been bitten by
 * exactly this class of bug on the Windows side (`AppId = 1`), and a cheap
 * query that silently doubles the numbers is the worst possible outcome.
 *
 * ## 2. It also performs the VPN de-duplication
 *
 * `dumpsys netstats` reports a VPN network under BOTH its own transport and the
 * one beneath it, so every byte that crossed a VPN is counted twice. The
 * public API resolves that before returning. This is the single strongest
 * reason the Android half is an on-device app rather than an adb parser.
 */
class UsageReader(private val context: Context) {

    /** The AOSP uid bucket, measured at 7200 s on this device. */
    private val bucketMs = 2 * 60 * 60 * 1000L

    data class Bucket(
        val uid: Int,
        val start: Long,
        val network: String,
        val metered: Boolean,
        val roaming: Boolean,
        val rx: Long,
        val tx: Long,
    )

    data class AppInfo(
        val uid: Int,
        val packageName: String,
        val label: String,
        val isSystem: Boolean,
    )

    private val nsm: NetworkStatsManager
        get() = context.getSystemService(NetworkStatsManager::class.java)

    /**
     * Every non-empty bucket between [from] and now, both networks.
     *
     * Aligned to the 2-hour grid so a bucket start always means the same
     * instant no matter when the sync ran -- otherwise the same traffic would
     * land under a different key on every upload and the upsert would never
     * match.
     */
    fun read(from: Long, now: Long = System.currentTimeMillis()): List<Bucket> {
        val out = ArrayList<Bucket>()
        var start = (from / bucketMs) * bucketMs
        val end = ((now / bucketMs) + 1) * bucketMs

        // Once per read, not per window: which SIMs are present does not change
        // between two 2-hour windows of one sync.
        val wifi = listOf<String?>(null)
        val mobile = mobileSubscriberIds()

        while (start < end) {
            val stop = start + bucketMs
            collect(ConnectivityManager.TYPE_WIFI, "wifi", wifi, start, stop, out)
            collect(ConnectivityManager.TYPE_MOBILE, "mobile", mobile, start, stop, out)
            start = stop
        }
        return out
    }

    /**
     * The subscriber ids to ask for mobile usage under.
     *
     * From API 29, `[null]`: a null id means "every subscription", including a
     * SIM that has since been taken out.
     *
     * **Below 29, null matches NOTHING, and says so by returning zero.** Read
     * off the Android 8.1 source rather than assumed: `createTemplate` builds
     * `buildTemplateMobileAll(null)`, whose `matchesMobile` looks the ident's
     * IMSI up in a list holding only null -- and every mobile ident carries an
     * IMSI. The query succeeds, returns no mobile rows, and the phone looks
     * like it simply never used mobile data. So on those versions each SIM's id
     * is asked for, one query per SIM, summed in [collect].
     *
     * The cost of that, accepted rather than hidden: only SIMs present at sync
     * time are read. A SIM taken out before the first sync takes its history
     * with it; one taken out later has already been collected.
     */
    @SuppressLint("MissingPermission", "HardwareIds")
    private fun mobileSubscriberIds(): List<String?> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return listOf(null)
        if (!SyncRunner.hasPhoneState(context)) {
            // Refuse rather than carry on with Wi-Fi alone. The watermark would
            // advance past every window read without mobile, and granting the
            // permission afterwards would not bring those windows back.
            throw PhoneStateDenied()
        }
        val tm = context.getSystemService(TelephonyManager::class.java)
        val subs = context.getSystemService(SubscriptionManager::class.java)
            .activeSubscriptionInfoList.orEmpty()
        // The default SIM is asked for as well, in case a dual-SIM build leaves
        // it out of the active list. distinct() is load-bearing, not tidiness:
        // querying one IMSI twice WOULD count its traffic twice.
        return (subs.map { tm.createForSubscriptionId(it.subscriptionId).subscriberId } +
            tm.subscriberId)
            .filterNotNull()
            .filter { it.isNotEmpty() }
            .distinct()
    }

    /**
     * Whether a bucket was on a metered network.
     *
     * `Bucket.getMetered` arrived in API 28; calling it on 27 is a
     * NoSuchMethodError. Below 28 the platform does not split buckets by
     * metering at all, so the answer comes from which template matched:
     *
     * - **mobile: true, by construction.** Android 8.1's `matchesMobile`
     *   accepts only idents with `mMetered` set, so every mobile byte these
     *   versions return came from a metered network.
     * - **Wi-Fi: false, meaning UNKNOWN.** The wildcard Wi-Fi template matches
     *   metered and unmetered networks alike, and nothing in the bucket says
     *   which. A metered hotspot on an old phone is stored as unmetered.
     *
     * Either way the rule is fixed per version, which is what the server's
     * primary key needs: the same window must land under the same key on every
     * read.
     */
    private fun isMetered(b: NetworkStats.Bucket, type: Int): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            b.metered == NetworkStats.Bucket.METERED_YES
        } else {
            type == ConnectivityManager.TYPE_MOBILE
        }

    /**
     * One 2-hour window of one network type, summed across [subscriberIds].
     *
     * Several ids only happens for mobile below API 29, one per SIM. Their
     * IMSIs are distinct, so their buckets are disjoint traffic and summing
     * them is correct -- the same reasoning as summing sub-buckets below.
     */
    private fun collect(
        type: Int,
        name: String,
        subscriberIds: List<String?>,
        start: Long,
        end: Long,
        into: MutableList<Bucket>,
    ) {

        /*
          SUM within one read, do not just emit each bucket.

          querySummary returns more than one bucket per uid for the same window:
          they differ by fields the dashboard does not key on, chiefly
          defaultNetworkStatus. Emitting them as separate rows made ~24% of an
          upload collide on the same primary key, and the server's MAX() upsert
          then kept the largest instead of the total -- which is correct across
          uploads, and silently lossy within one.

          Caught by comparing the first real sync against the dumpsys ground
          truth over 30 days: low by 1.2%, and in
          the WRONG DIRECTION, because querySummary re-attributes VPN traffic
          that the dumpsys figure excludes outright, so ours should have been
          higher. A deficit that small is exactly the kind that never gets
          noticed without something to check it against.

          Summing here and MAX()-ing on the server is the right split: within a
          read, sub-buckets are parts of one total; across reads, the later
          reading of a still-filling bucket supersedes the earlier one.
        */
        val merged = HashMap<String, Bucket>()
        for (subscriberId in subscriberIds) {
            val stats = try {
                nsm.querySummary(type, subscriberId, start, end)
            } catch (e: SecurityException) {
                // Usage access was revoked between the check and the read.
                throw UsageAccessDenied()
            } catch (e: RemoteException) {
                // The whole window, not just this SIM: emitting the other SIMs'
                // share alone would store a partial sum under the full key.
                return
            }

            stats.use {
                val b = NetworkStats.Bucket()
                while (it.hasNextBucket()) {
                    it.getNextBucket(b)
                    if (b.rxBytes == 0L && b.txBytes == 0L) continue
                    val metered = isMetered(b, type)
                    val roaming = b.roaming == NetworkStats.Bucket.ROAMING_YES
                    val key = "${b.uid}|$metered|$roaming"
                    val prev = merged[key]
                    merged[key] = if (prev == null) {
                        Bucket(b.uid, start, name, metered, roaming, b.rxBytes, b.txBytes)
                    } else {
                        prev.copy(rx = prev.rx + b.rxBytes, tx = prev.tx + b.txBytes)
                    }
                }
            }
        }
        into.addAll(merged.values)
    }

    /**
     * uid -> package -> label, for every installed package.
     *
     * The phone is the only thing that can answer this. A uid is not an app:
     * uid 1000 covers 24 packages on this device, and a cloned app under user
     * profile 999 has a uid the dashboard could never map back. Sending the
     * label PackageManager already knows means the dashboard needs no curated
     * name table for Android at all.
     */
    fun apps(): List<AppInfo> {
        val pm = context.packageManager
        val installed = pm.getInstalledApplications(PackageManager.GET_META_DATA)
        return installed.map { info ->
            AppInfo(
                uid = info.uid,
                packageName = info.packageName,
                label = pm.getApplicationLabel(info).toString(),
                isSystem = (info.flags and ApplicationInfo.FLAG_SYSTEM) != 0,
            )
        }
    }

    class UsageAccessDenied : Exception("Usage access has not been granted")

    class PhoneStateDenied : Exception("Phone permission has not been granted")
}
