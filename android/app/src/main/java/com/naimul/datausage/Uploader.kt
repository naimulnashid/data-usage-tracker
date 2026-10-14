package com.naimul.datausage

import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URL
import java.util.TimeZone
import java.util.zip.GZIPOutputStream

/**
 * Sending a batch to the dashboard, or to the cloud inbox.
 *
 * `HttpURLConnection` rather than OkHttp: see the no-dependencies note in
 * build.gradle.kts. This posts one body and reads one back.
 *
 * With the cloud inbox on (`prefs.usesInbox`), the same gzipped JSON is sealed
 * to the laptop's key (Sealer) and posted to the inbox, which stores it until
 * the laptop collects it. Nothing else about an upload changes.
 */
class Uploader(private val prefs: Prefs) {

    data class Result(val ok: Boolean, val message: String, val acceptedThrough: Long?)

    /** What the dashboard hands out for "Set up cloud inbox". */
    data class InboxSetup(val url: String, val publicKey: String, val fingerprint: String)

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
        if (prefs.usesInbox) return testInbox()
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

    private fun testInbox(): Result {
        val conn = open(URL(prefs.inboxUrl), "GET", Sealer.uploadBearer(prefs.token))
        return try {
            val code = conn.responseCode
            val body = readBody(conn)
            val isInbox = code == 200 && try {
                JSONObject(body).optBoolean("inbox")
            } catch (e: Exception) {
                false
            }
            Result(isInbox, if (isInbox) "Cloud inbox reachable" else "Cloud inbox: HTTP $code: $body", null)
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Ask the dashboard, over the LAN, where its cloud inbox is and which key
     * to seal to. Fetched from the dashboard rather than typed in or taken
     * from the inbox: the inbox is exactly the party that must not be able to
     * substitute its own key.
     */
    fun fetchInboxSetup(): InboxSetup {
        val url = URL("${prefs.serverUrl}/api/android/ingest")
        assertPrivateIfCleartext(url)
        val conn = open(url, "GET")
        try {
            val code = conn.responseCode
            val body = readBody(conn)
            if (code != 200) throw IllegalStateException("Dashboard: HTTP $code: $body")
            val inbox = JSONObject(body).optJSONObject("inbox")
                ?: throw IllegalStateException(
                    "The dashboard has no cloud inbox set up, or is older than 3.5.0",
                )
            inbox.optString("error").takeIf { it.isNotEmpty() }?.let {
                throw IllegalStateException("The dashboard's inbox is misconfigured: $it")
            }
            val setup = InboxSetup(
                inbox.getString("url"), inbox.getString("publicKey"), inbox.getString("fingerprint"),
            )
            // The inbox is on the internet, so cleartext is never acceptable.
            if (!setup.url.startsWith("https://")) {
                throw IllegalStateException("Refusing an inbox address that is not https: ${setup.url}")
            }
            Sealer.parseKey(setup.publicKey) // throws on anything but a P-256 key
            return setup
        } finally {
            conn.disconnect()
        }
    }

    fun upload(
        buckets: List<UsageReader.Bucket>,
        apps: List<UsageReader.AppInfo>,
    ): Result {
        if (prefs.usesInbox) return uploadToInbox(buckets, apps)
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

    private fun uploadToInbox(
        buckets: List<UsageReader.Bucket>,
        apps: List<UsageReader.AppInfo>,
    ): Result {
        val json = buildPayload(buckets, apps).toString().toByteArray(Charsets.UTF_8)
        val zipped = ByteArrayOutputStream().also { out ->
            GZIPOutputStream(out).use { it.write(json) }
        }.toByteArray()
        val envelope = Sealer.seal(zipped, Sealer.parseKey(prefs.inboxKey), prefs.token)

        val conn = open(URL(prefs.inboxUrl), "POST", Sealer.uploadBearer(prefs.token))
        conn.setRequestProperty("Content-Type", "application/octet-stream")
        // Lets the dashboard say which phone an envelope it cannot open came from.
        conn.setRequestProperty("X-Device-Hint", prefs.deviceId)
        conn.doOutput = true
        conn.setFixedLengthStreamingMode(envelope.size)

        return try {
            conn.outputStream.use { it.write(envelope) }
            val code = conn.responseCode
            val text = readBody(conn)
            if (code != 200) return Result(false, "Cloud inbox: HTTP $code: $text", null)
            val reply = JSONObject(text)
            if (!reply.optBoolean("ok") || !reply.optBoolean("inbox")) {
                return Result(false, reply.optString("error", "rejected by the cloud inbox"), null)
            }
            /*
              The inbox cannot read what it stored, so it cannot say what it
              accepted; the newest bucket SENT stands in for it. That is the
              same value the dashboard would have confirmed (its acceptedThrough
              is the newest bucket start it wrote), and the inbox only answers
              200 once the envelope is stored. If the laptop later rejects it,
              the Sync page says so and "Full resync" sends the window again.
            */
            Result(
                ok = true,
                message = "${buckets.size} buckets sent to the cloud inbox",
                acceptedThrough = buckets.maxOfOrNull { it.start },
            )
        } finally {
            conn.disconnect()
        }
    }

    private fun open(url: URL, method: String, bearer: String = prefs.token): HttpURLConnection {
        val conn = url.openConnection() as HttpURLConnection
        // Never follow a redirect. assertPrivateIfCleartext vets the address the
        // user typed, and a followed redirect would carry the request -- bearer
        // token included -- to one it never saw. The dashboard does not
        // redirect this endpoint, so a 3xx is itself worth reporting.
        conn.instanceFollowRedirects = false
        conn.requestMethod = method
        conn.setRequestProperty("Authorization", "Bearer $bearer")
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
