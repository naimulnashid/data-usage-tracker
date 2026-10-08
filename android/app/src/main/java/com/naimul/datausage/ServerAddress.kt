package com.naimul.datausage

import java.net.URI

/**
 * What is wrong with a typed dashboard address, in words a person can act on.
 *
 * Before 1.4.1 the field took anything. `http:192.168.1.20:7843` -- the `//`
 * forgotten on a phone keyboard -- was saved without complaint and every sync
 * then failed with an error naming neither the field nor the typo. Each rule
 * below says what is wrong AND, where it can, what the address should read.
 */
object ServerAddress {

    const val EXAMPLE = "http://192.168.1.20:7843"

    /** Null when the address is usable; otherwise the problem, as a sentence. */
    fun problem(raw: String): String? {
        val s = raw.trim().trimEnd('/')
        if (s.isEmpty()) return "Enter the dashboard address, e.g. $EXAMPLE"
        if (s.any { it.isWhitespace() }) return "The address contains a space. Remove it."

        val scheme = Regex("^([A-Za-z][A-Za-z0-9+.-]*)(:?)(/*)").find(s)
        val name = scheme?.groupValues?.get(1)?.lowercase()
        val colon = scheme?.groupValues?.get(2) ?: ""
        val slashes = scheme?.groupValues?.get(3) ?: ""
        val rest = s.substring(scheme?.value?.length ?: 0)

        if (name == "http" || name == "https") {
            if (rest.isEmpty()) return "No PC address after $name://, e.g. $EXAMPLE"
            if (slashes.length > 2) {
                return "Too many \"/\" after \"$name:\". It should read $name://$rest"
            }
            if (colon.isEmpty() && slashes.isNotEmpty()) {
                return "Missing \":\" after \"$name\". It should read $name://$rest"
            }
            if (colon.isNotEmpty() && slashes.length != 2) {
                return "Missing \"//\" after \"$name:\". It should read $name://$rest"
            }
        }
        if (colon.isEmpty() || slashes.isEmpty()) {
            // No scheme at all. "192.168.1.20:7843" does not match the regex
            // (it starts with a digit), and "pc.local:7843" matches it as a
            // scheme "pc.local" with no slashes; both land here.
            if (!s.contains("://")) return "Start the address with http://, e.g. http://$s"
        }
        if (name != "http" && name != "https") {
            return "\"$name://\" is not supported. Start the address with http:// or https://"
        }

        val uri = try {
            URI(s)
        } catch (e: Exception) {
            return "This is not a valid address: ${e.message}"
        }
        if (uri.rawUserInfo != null) return "Remove the \"${uri.rawUserInfo}@\" part. Only host and port go here."

        // URI leaves host null when the port is not a number, so read the
        // authority by hand to say which one it is.
        val authority = uri.rawAuthority ?: ""
        if (authority.isEmpty()) return "No PC address after $name://, e.g. $EXAMPLE"
        val portText = authority.substringAfterLast(':', "").takeIf { ':' in authority && !authority.endsWith(']') }
        if (portText != null) {
            if (portText.isEmpty()) return "Nothing after the \":\". Add the port, e.g. :7843, or remove the \":\""
            val port = portText.toIntOrNull()
                ?: return "The port \"$portText\" is not a number. It should be like :7843"
            if (port !in 1..65535) return "The port $port is out of range (1 to 65535)."
        }
        if (uri.host.isNullOrEmpty()) return "\"$authority\" is not a valid PC address."

        val extra = (uri.rawPath ?: "") +
            (uri.rawQuery?.let { "?$it" } ?: "") + (uri.rawFragment?.let { "#$it" } ?: "")
        if (extra.isNotEmpty()) {
            return "Remove \"$extra\". The app adds the path itself, so the address is just " +
                "$name://$authority"
        }
        return null
    }

    /**
     * A hint for a connection that failed on a usable address: no port means
     * port 80 (or 443), and the dashboard listens on 7843 unless changed.
     */
    fun failureHint(raw: String): String? = try {
        if (URI(raw.trim()).port == -1) {
            "No port in the address, so this tried ${if (raw.startsWith("https", true)) 443 else 80}. " +
                "The dashboard listens on 7843 unless you changed it."
        } else {
            null
        }
    } catch (e: Exception) {
        null
    }
}
