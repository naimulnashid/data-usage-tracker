/**
 * The cloud inbox, laptop side: opening sealed envelopes and draining them in.
 *
 * Why an inbox at all: a phone used to post straight to this dashboard on the
 * LAN, so its address changed with every router reboot and every other house,
 * and nothing could be sent while the laptop was off. The inbox is a fixed
 * HTTPS address (a Supabase Edge Function, `supabase/functions/inbox`) that
 * the phone posts to from anywhere; the laptop empties it whenever it is on,
 * through the same `validatePayload` + `ingestAndroid` a direct upload uses.
 *
 * **The inbox can read nothing.** The phone encrypts each upload to a P-256
 * key whose private half lives only on this machine (`inbox.keyPath` in
 * config, on D:, never in the repo), so Supabase -- or anyone who gets into
 * the project -- holds ciphertext and a device id.
 *
 * ENVELOPE, version 1 (the Android app's Sealer.kt writes the same bytes):
 *
 *   "DUI1"                 4 bytes   magic, and the version
 *   ephemeral public key  65 bytes   uncompressed P-256 point, new per upload
 *   nonce                 12 bytes
 *   ciphertext + tag       rest      AES-256-GCM, 16-byte tag at the end
 *
 *   shared = ECDH(ephemeral, laptop key)                 x-coordinate, 32 bytes
 *   salt   = HMAC-SHA256(ANDROID_INGEST_TOKEN, "data-usage inbox seal v1")
 *   key    = HKDF-SHA256(shared, salt, "data-usage inbox v1" || ephemeral, 32)
 *   aad    = magic || ephemeral
 *   plain  = gzip(the same JSON a direct upload sends)
 *
 * **The token in the salt is what makes an envelope authentic, not just
 * private.** The laptop's key is public by definition, so anyone could seal
 * to it; only a holder of the ingest token can derive a key the laptop will
 * accept. And the inbox never sees that token: phones authenticate to it with
 * `uploadBearer(token)`, an HMAC of it. Replaying an old envelope is harmless,
 * since the ingest upserts with MAX().
 */

import {
  createHmac, createPrivateKey, createPublicKey, createCipheriv, createDecipheriv,
  diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, createHash, type KeyObject,
} from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { configPath } from './config-path';
import {
  validatePayload, ingestAndroid, logAndroidSync, type IngestOptions,
} from './android-ingest';

export const MAGIC = Buffer.from('DUI1', 'ascii');
const POINT_BYTES = 65;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const SEAL_LABEL = 'data-usage inbox seal v1';
const UPLOAD_LABEL = 'data-usage inbox upload v1';
const INFO_LABEL = 'data-usage inbox v1';

/** Decompressed cap, the same as a direct upload's MAX_BODY_BYTES. */
const MAX_PLAIN_BYTES = 8 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface InboxConfig {
  /** The Edge Function's address, e.g. https://<ref>.supabase.co/functions/v1/inbox */
  url: string;
  /** PKCS#8 PEM of this laptop's P-256 key. Must not be under C:\ or the repo. */
  keyPath: string;
}

/** `inbox` in config/collector.json, or null when the inbox is not in use. */
export function inboxConfig(): InboxConfig | null {
  const cfg = JSON.parse(readFileSync(configPath(), 'utf8')) as { inbox?: Partial<InboxConfig> | null };
  const i = cfg.inbox;
  if (!i || typeof i.url !== 'string' || typeof i.keyPath !== 'string' || !i.url || !i.keyPath) return null;
  if (!i.url.startsWith('https://')) throw new Error('inbox.url must be an https:// address');
  return { url: i.url.replace(/\/+$/, ''), keyPath: i.keyPath };
}

/**
 * A secret from the environment, else from `.env.local`.
 *
 * Next loads `.env.local` into the dashboard's environment; the drain also runs
 * from scheduled tasks, which get no such help. Same parsing as run-next.mjs.
 */
export function secret(name: string): string | undefined {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return undefined;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0 || line.slice(0, eq).trim() !== name) continue;
    return line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2') || undefined;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

export function loadInboxKey(keyPath: string): KeyObject {
  const key = createPrivateKey(readFileSync(keyPath, 'utf8'));
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error(`${keyPath} is not a P-256 key`);
  }
  return key;
}

export function newInboxKeyPem(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

/** The public half as base64 SPKI DER: what the phone stores. */
export function publicKeyB64(key: KeyObject): string {
  return (createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
}

/**
 * Sixteen hex digits of SHA-256 over the SPKI, in groups of four. The phone
 * shows the same string, so the two can be compared by eye.
 */
export function fingerprint(spkiB64: string): string {
  const hex = createHash('sha256').update(Buffer.from(spkiB64, 'base64')).digest('hex').slice(0, 16);
  return hex.toUpperCase().match(/.{4}/g)!.join(' ');
}

/** The bearer a phone presents to the inbox. The inbox stores its SHA-256. */
export function uploadBearer(token: string): string {
  return createHmac('sha256', token).update(UPLOAD_LABEL).digest('hex');
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/* ------------------------------------------------------------------ */
/* Envelopes                                                           */
/* ------------------------------------------------------------------ */

function pointOf(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' }) as { x: string; y: string };
  return Buffer.concat([
    Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url'),
  ]);
}

function keyFromPoint(point: Buffer): KeyObject {
  if (point.length !== POINT_BYTES || point[0] !== 0x04) throw new Error('bad ephemeral key');
  return createPublicKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
    format: 'jwk',
  });
}

function aesKey(shared: Buffer, point: Buffer, token: string): Buffer {
  const salt = createHmac('sha256', token).update(SEAL_LABEL).digest();
  const info = Buffer.concat([Buffer.from(INFO_LABEL, 'ascii'), point]);
  return Buffer.from(hkdfSync('sha256', shared, salt, info, 32));
}

/**
 * Seal bytes to a laptop key. The phone does this, in Kotlin; this copy
 * exists for the self-test and for checking a deployed inbox end to end.
 */
export function sealEnvelope(plain: Buffer, recipientSpkiB64: string, token: string): Buffer {
  const recipient = createPublicKey({ key: Buffer.from(recipientSpkiB64, 'base64'), format: 'der', type: 'spki' });
  const eph = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const point = pointOf(eph.publicKey);
  const key = aesKey(diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), point, token);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.concat([MAGIC, point]));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, point, nonce, body, cipher.getAuthTag()]);
}

/**
 * Open an envelope, or throw. A wrong key, a wrong token and a tampered byte
 * all fail the same way, at the GCM tag, and are reported as one error.
 */
export function openEnvelope(envelope: Buffer, key: KeyObject, token: string): Buffer {
  if (envelope.length < MAGIC.length + POINT_BYTES + NONCE_BYTES + TAG_BYTES) throw new Error('envelope too short');
  if (!envelope.subarray(0, 4).equals(MAGIC)) throw new Error('not a DUI1 envelope');
  const point = envelope.subarray(4, 4 + POINT_BYTES);
  const nonce = envelope.subarray(4 + POINT_BYTES, 4 + POINT_BYTES + NONCE_BYTES);
  const body = envelope.subarray(4 + POINT_BYTES + NONCE_BYTES, envelope.length - TAG_BYTES);
  const tag = envelope.subarray(envelope.length - TAG_BYTES);

  const aes = aesKey(diffieHellman({ privateKey: key, publicKey: keyFromPoint(point) }), point, token);
  const decipher = createDecipheriv('aes-256-gcm', aes, nonce);
  decipher.setAAD(Buffer.concat([MAGIC, point]));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error(
      'cannot open envelope: sealed to another laptop key, with another ingest token, or altered',
    );
  }
}

/** Envelope -> the payload JSON a direct upload would have carried. */
export function envelopeJson(envelope: Buffer, key: KeyObject, token: string): unknown {
  const zipped = openEnvelope(envelope, key, token);
  return JSON.parse(gunzipSync(zipped, { maxOutputLength: MAX_PLAIN_BYTES }).toString('utf8'));
}

/* ------------------------------------------------------------------ */
/* Draining                                                            */
/* ------------------------------------------------------------------ */

interface Pending {
  id: number;
  received_at: string;
  device_hint: string | null;
  envelope: string;
}

export interface DrainOptions extends IngestOptions {
  /** Also try envelopes an earlier drain marked failed. */
  retryFailed?: boolean;
  /** Open and validate, write nothing, acknowledge nothing. */
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface DrainOutcome {
  landed: number;
  failed: number;
  rowsWritten: number;
}

async function call(cfg: InboxConfig, drainToken: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${cfg.url}/${path}`, {
    ...init,
    redirect: 'error',
    headers: { Authorization: `Bearer ${drainToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(`inbox ${path}: HTTP ${res.status} ${body.error ?? ''}`.trim());
  return body;
}

/**
 * Empty the inbox into the database.
 *
 * Each envelope goes through exactly what a direct upload goes through, and is
 * logged in `android_sync_log` with `received_at` = when the PHONE sent it and
 * `landed_at` = now. Acknowledged only after the write: if the acknowledgement
 * is lost, the next drain ingests the envelope again, which the MAX() upsert
 * makes harmless (it costs a duplicate log row).
 *
 * An envelope that cannot be opened or is rejected is marked failed in the
 * inbox and skipped from then on, rather than retried and logged every 15
 * minutes. The phone has already moved past that data, so the fix is to
 * correct the cause and run with `retryFailed`, or press "Full resync" on the
 * phone.
 */
export async function drainInbox(opts: DrainOptions = {}): Promise<DrainOutcome | null> {
  const cfg = inboxConfig();
  if (!cfg) return null;
  const log = opts.log ?? (() => {});

  const ingestToken = secret('ANDROID_INGEST_TOKEN');
  const drainToken = secret('INBOX_DRAIN_TOKEN');
  if (!ingestToken) throw new Error('ANDROID_INGEST_TOKEN is not set in .env.local');
  if (!drainToken) throw new Error('INBOX_DRAIN_TOKEN is not set in .env.local');
  const key = loadInboxKey(cfg.keyPath);

  const out: DrainOutcome = { landed: 0, failed: 0, rowsWritten: 0 };
  // Paged by id rather than by "whatever is left", so an envelope that stays
  // behind -- a dry run, a retry that fails again -- is never fetched twice.
  let after = 0;

  for (;;) {
    const page = (await call(
      cfg, drainToken, `pending?limit=10&after=${after}${opts.retryFailed ? '&failed=1' : ''}`,
    )) as { envelopes: Pending[] };
    if (page.envelopes.length === 0) break;

    const done: number[] = [];
    const failed: { id: number; error: string }[] = [];

    for (const e of page.envelopes) {
      after = Math.max(after, e.id);
      const receivedAt = new Date(e.received_at).toISOString();
      let deviceId = e.device_hint;
      try {
        const body = envelopeJson(Buffer.from(e.envelope, 'base64'), key, ingestToken);
        const payload = validatePayload(body);
        deviceId = payload.deviceId;
        if (opts.dryRun) {
          log(`#${e.id} ${deviceId}: opens, ${payload.buckets.length} buckets (dry run)`);
          continue;
        }
        const r = ingestAndroid(payload, opts);
        logAndroidSync(payload.deviceId, 'success', {
          bucketsSent: payload.buckets.length,
          rowsWritten: r.written,
          rowsUpdated: r.updated,
          appsSent: r.apps,
          oldest: r.oldest,
          newest: r.newest,
          appVersion: payload.appVersion,
          receivedAt,
          landedAt: new Date().toISOString(),
        }, opts);
        out.landed++;
        out.rowsWritten += r.written;
        done.push(e.id);
        log(`#${e.id} ${deviceId}: ${r.written} new, ${r.updated} updated`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`#${e.id} ${deviceId ?? 'unknown phone'}: ${message}`);
        if (opts.dryRun) continue;
        if (deviceId) {
          logAndroidSync(deviceId, 'rejected', {
            error: `inbox: ${message}`, receivedAt, landedAt: new Date().toISOString(),
          }, opts);
        }
        out.failed++;
        failed.push({ id: e.id, error: message });
      }
    }

    if (!opts.dryRun && (done.length > 0 || failed.length > 0)) {
      await call(cfg, drainToken, 'ack', { method: 'POST', body: JSON.stringify({ done, failed }) });
    }
  }
  return out;
}
