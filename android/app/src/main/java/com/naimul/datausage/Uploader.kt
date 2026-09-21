package com.naimul.datausage

import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URL
import java.util.TimeZone
import java.util.zip.GZIPOutputStream

/**
 * Sending a batch to the dashboard.
 *
 * `HttpURLConnection` rather than OkHttp: see the no-dependencies note in
 * build.gradle.kts. This posts one JSON body and reads one back.
 */
class Uploader(private val prefs: Prefs) {

    data class Result(val ok: Boolean, val message: String, val acceptedThrough: Long?)

    /**
     * Refuse to send cleartext anywhere but the local network.
     *
     * The network security config has to allow cleartext broadly, because
     * Android matches domains and cannot express "the private ranges" -- a
     * literal address list breaks the day the PC's DHCP lease changes. So the
     * real check lives here, where actual CIDR arithmetic is possible.
     *
     * This is not paranoia about the LAN. It is that a typo in the server field
     * would otherwise post this phone's complete per-app usage history, in
     * clear, to whatever host happened to be at that address.
     */
    private fun assertPrivateIfCleartext(url: URL) {
        if (!url.protocol.equals("http", ignoreCase = true)) return

        val host = url.host
        val addr: InetAddress = try {
            InetAddress.getByName(host)
        } catch (e: Exception) {
            throw IllegalArgumentException("Cannot resolve $host")
        }
        val private = addr.isLoopbackAddress || addr.isLinkLocalAddress || addr.isSiteLocalAddress
        if (!private) {
            throw IllegalArgumentException(
                "Refusing to send usage history in clear to $host, which is not a " +
                    "private address. Use https, or check the server address.",
            )
        }
        if (addr is Inet4Address) {
            // isSiteLocalAddress already covers 10/8, 172.16/12 and 192.168/16.
            // Carrier-grade NAT (100.64/10) is not "yours" and is excluded on
            // purpose: a phone on mobile data can reach other subscribers there.
            val b = addr.address
            val first = b[0].toInt() and 0xFF
            val second = b[1].toInt() and 0xFF
            if (first == 100 && second in 64..127) {
                throw IllegalArgumentException("Refusing to send to carrier-grade NAT space")
            }
        }
    }

    fun test(): Result {
        val url = URL("${prefs.serverUrl}/api/android/ingest")
        assertPrivateIfCleartext(url)
        val conn = open(url, "GET")
        return try {
            val code = conn.responseCode
            val body = readBody(conn)
            Result(code == 200, if (code == 200) "Reachable" else "HTTP $code: $body", null)
        } finally {
            conn.disconnect()
        }
    }

    fun upload(
        buckets: List<UsageReader.Bucket>,
        apps: List<UsageReader.AppInfo>,
    ): Result {
        val url = URL("${prefs.serverUrl}/api/android/ingest")
        assertPrivateIfCleartext(url)

        val body = buildPayload(buckets, apps).toString().toByteArray(Charsets.UTF_8)
        val conn = open(url, "POST")
        conn.setRequestProperty("Content-Type", "application/json")
        // A 90-day backfill is a few MB of very repetitive JSON; gzip takes it
        // to a fraction of that over Wi-Fi that may be the phone's own hotspot.
        conn.setRequestProperty("Content-Encoding", "gzip")
        conn.doOutput = true

        return try {
            GZIPOutputStream(BufferedOutputStream(conn.outputStream)).use { it.write(body) }
            val code = conn.responseCode
            val text = readBody(conn)
            if (code != 200) return Result(false, "HTTP $code: $text", null)

            val json = JSONObject(text)
            if (!json.optBoolean("ok")) {
                return Result(false, json.optString("error", "rejected"), null)
            }
            val through = json.optString("acceptedThrough", "")
            Result(
                ok = true,
                message = "Stored ${json.optInt("written")} new, " +
                    "updated ${json.optInt("updated")}, ${buckets.size} buckets sent",
                acceptedThrough = parseIso(through),
            )
        } finally {
            conn.disconnect()
        }
    }

    private fun open(url: URL, method: String): HttpURLConnection {
        val conn = url.openConnection() as HttpURLConnection
        // Never follow a redirect. assertPrivateIfCleartext vets the address the
        // user typed, and a followed redirect would carry the request -- bearer
        // token included -- to one it never saw. The dashboard does not
        // redirect this endpoint, so a 3xx is itself worth reporting.
        conn.instanceFollowRedirects = false
        conn.requestMethod = method
        conn.setRequestProperty("Authorization", "Bearer ${prefs.token}")
        conn.setRequestProperty("Accept", "application/json")
        conn.connectTimeout = 10_000
        conn.readTimeout = 60_000
        return conn
    }

    private fun readBody(conn: HttpURLConnection): String =
        try {
            (if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
        } catch (e: Exception) {
            e.message ?: "no response"
        }

    private fun buildPayload(
        buckets: List<UsageReader.Bucket>,
        apps: List<UsageReader.AppInfo>,
    ): JSONObject {
        val now = System.currentTimeMillis()
        return JSONObject().apply {
            put("deviceId", prefs.deviceId)
            put("brand", Build.MANUFACTURER)
            put("model", Build.MODEL)
            put("label", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("release", Build.VERSION.RELEASE)
            put("sdk", Build.VERSION.SDK_INT)
            put("appVersion", BuildConfig.VERSION_NAME)
            // The PHONE's offset, so the dashboard buckets days the way this
            // device experiences them rather than the way the server does.
            put("utcOffsetMinutes", TimeZone.getDefault().getOffset(now) / 60_000)

            put("apps", JSONArray().also { arr ->
                for (a in apps) {
                    arr.put(
                        JSONObject()
                            .put("uid", a.uid)
                            .put("package", a.packageName)
                            .put("label", a.label)
                            .put("isSystem", a.isSystem),
                    )
                }
            })

            put("buckets", JSONArray().also { arr ->
                for (b in buckets) {
                    arr.put(
                        JSONObject()
                            .put("uid", b.uid)
                            .put("start", b.start)
                            .put("network", b.network)
                            .put("metered", b.metered)
                            .put("roaming", b.roaming)
                            .put("rx", b.rx)
                            .put("tx", b.tx),
                    )
                }
            })
        }
    }

    private fun parseIso(s: String): Long? =
        if (s.isEmpty()) null
        else try {
            java.time.Instant.parse(s).toEpochMilli()
        } catch (e: Exception) {
            null
        }
}
