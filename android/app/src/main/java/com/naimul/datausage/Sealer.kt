package com.naimul.datausage

import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Sealing an upload for the cloud inbox, so the inbox stores what it cannot
 * read.
 *
 * Each upload is encrypted to the laptop's P-256 public key with a fresh
 * ephemeral key: ECDH, then HKDF-SHA256, then AES-256-GCM. The ingest token is
 * mixed into the HKDF salt, which is what lets the laptop tell an upload from
 * this app from one sealed by anyone else -- the public key is public. The
 * byte layout and every label must match `src/lib/inbox.ts`; that file has
 * the format written out.
 *
 * Only java.* and javax.* on purpose: no android.* import, so the self-test
 * can compile this file on a desktop JVM and check it against the Node side.
 * java.util.Base64 is API 26, which is minSdk.
 */
object Sealer {

    private val MAGIC = "DUI1".toByteArray(Charsets.US_ASCII)
    private const val SEAL_LABEL = "data-usage inbox seal v1"
    private const val UPLOAD_LABEL = "data-usage inbox upload v1"
    private const val INFO_LABEL = "data-usage inbox v1"

    /** The laptop's key, from the base64 SPKI the dashboard hands out. Throws if it is not P-256. */
    fun parseKey(spkiB64: String): ECPublicKey {
        val der = Base64.getDecoder().decode(spkiB64.trim())
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(der)) as ECPublicKey
        require(key.params.order.bitLength() == 256 && key.params.curve.field.fieldSize == 256) {
            "The laptop key is not a P-256 key"
        }
        return key
    }

    /** Sixteen hex digits of SHA-256 over the SPKI, as the dashboard prints it. */
    fun fingerprint(spkiB64: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(Base64.getDecoder().decode(spkiB64.trim()))
        return digest.take(8).joinToString("") { "%02X".format(it) }.chunked(4).joinToString(" ")
    }

    /**
     * The bearer this phone shows the inbox: an HMAC of the ingest token, never
     * the token itself, because the token is also what authenticates the
     * envelopes and the inbox is the one party that must not be able to forge
     * them.
     */
    fun uploadBearer(token: String): String =
        hmac(token.toByteArray(Charsets.UTF_8), UPLOAD_LABEL.toByteArray(Charsets.US_ASCII))
            .joinToString("") { "%02x".format(it) }

    fun seal(plain: ByteArray, laptopKey: ECPublicKey, token: String): ByteArray {
        val gen = KeyPairGenerator.getInstance("EC")
        gen.initialize(ECGenParameterSpec("secp256r1"))
        val eph = gen.generateKeyPair()
        val point = uncompressed(eph.public as ECPublicKey)

        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(eph.private)
        agreement.doPhase(laptopKey, true)
        val shared = agreement.generateSecret()

        val salt = hmac(token.toByteArray(Charsets.UTF_8), SEAL_LABEL.toByteArray(Charsets.US_ASCII))
        val key = hkdf(shared, salt, INFO_LABEL.toByteArray(Charsets.US_ASCII) + point)

        val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(MAGIC + point)
        return MAGIC + point + nonce + cipher.doFinal(plain)
    }

    /** 0x04 || X || Y, each coordinate left-padded to 32 bytes. */
    private fun uncompressed(key: ECPublicKey): ByteArray =
        byteArrayOf(0x04) + fixed32(key.w.affineX) + fixed32(key.w.affineY)

    /** BigInteger.toByteArray is signed and minimal: it can be 31 or 33 bytes. */
    private fun fixed32(n: BigInteger): ByteArray {
        val raw = n.toByteArray().let { if (it.size > 32) it.copyOfRange(it.size - 32, it.size) else it }
        return ByteArray(32 - raw.size) + raw
    }

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(data)
        }

    /** RFC 5869 with one output block, which is all a 32-byte key needs. */
    private fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray): ByteArray {
        val prk = hmac(salt, ikm)
        return hmac(prk, info + byteArrayOf(0x01))
    }
}
