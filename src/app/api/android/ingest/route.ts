import { gunzipSync } from 'node:zlib';
import { NextResponse } from 'next/server';
import { safeEqual } from '@/lib/auth';
import {
  validatePayload, ingestAndroid, logAndroidSync, databaseReady,
} from '@/lib/android-ingest';

/**
 * Where the phone posts its usage.
 *
 * Authenticated by a bearer token, NOT by the dashboard session cookie. The
 * phone is not a browser: it has no login form, and giving the app the
 * dashboard password would mean a second copy of it living on a device that
 * leaves the house. A dedicated token can also be rotated without signing every
 * browser out.
 *
 *   ANDROID_INGEST_TOKEN=<long random string>   in .env.local
 *
 * **It fails closed**, exactly like DASHBOARD_PASSWORD: an unset token rejects
 * every upload rather than accepting them all. Never "helpfully" make a missing
 * token mean open ingest -- this endpoint writes to the database the whole
 * project exists to protect.
 *
 * `middleware.ts` lets this path through its session gate precisely because the
 * check below is stricter, not because it is exempt.
 */

export const dynamic = 'force-dynamic';

/** 8 MB of JSON. Three months of buckets from a busy phone is a few MB. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * 2 MB on the wire. Separate from the decompressed cap so a small gzip stream
 * that expands to something enormous is rejected on its OUTPUT size, not its
 * input -- `gunzipSync`'s `maxOutputLength` is what actually enforces that.
 */
const MAX_WIRE_BYTES = 2 * 1024 * 1024;

/**
 * Read the body, decompressing if the client gzipped it.
 *
 * **Nothing does this for you.** `Content-Encoding` on a REQUEST is not part of
 * what Next, Node or fetch handle automatically -- it is near-universally
 * implemented for responses only. The first real upload from the phone failed
 * with `Unexpected token ''`, which is the gzip magic number arriving at
 * `JSON.parse` intact.
 *
 * Keeping gzip rather than dropping it: a first sync backfills ~57 days across
 * 128 uids and two networks, and that JSON is enormously repetitive.
 */
function readBody(raw: ArrayBuffer, encoding: string): string {
  const buf = Buffer.from(raw);
  if (!encoding.toLowerCase().includes('gzip')) return buf.toString('utf8');
  // maxOutputLength makes a decompression bomb an error rather than an
  // out-of-memory kill on the machine hosting the database.
  return gunzipSync(buf, { maxOutputLength: MAX_BODY_BYTES }).toString('utf8');
}

/**
 * Read the request body, refusing it once it passes `limit` bytes.
 *
 * `request.arrayBuffer()` reads the WHOLE body before returning, so the size
 * check used to run after the memory was already spent: a client could send
 * any amount and it was buffered first, rejected second. A declared
 * Content-Length over the limit is now refused before a byte is read, and a
 * chunked body is counted as it arrives.
 */
async function readCapped(request: Request, limit: number): Promise<ArrayBuffer | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out.buffer;
}

function configuredToken(): string | undefined {
  const t = process.env.ANDROID_INGEST_TOKEN;
  return t && t.length >= 16 ? t : undefined;
}

function unauthorised(reason: string) {
  // Deliberately terse to the caller. The detail goes in the response only
  // because this endpoint is LAN-local and the alternative is an app author
  // guessing why a 401 happened.
  return NextResponse.json({ ok: false, error: reason }, { status: 401 });
}

export async function POST(request: Request) {
  const token = configuredToken();
  if (!token) {
    return unauthorised('ingest-not-configured: set ANDROID_INGEST_TOKEN in .env.local');
  }

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented || !(await safeEqual(presented, token))) {
    return unauthorised('bad-token');
  }

  if (!databaseReady()) {
    return NextResponse.json(
      { ok: false, error: 'no-database: the Windows collector has not created it yet' },
      { status: 503 },
    );
  }

  const wire = await readCapped(request, MAX_WIRE_BYTES);
  if (wire === null) {
    return NextResponse.json({ ok: false, error: 'body-too-large' }, { status: 413 });
  }

  let raw = '';
  let payload;
  try {
    raw = readBody(wire, request.headers.get('content-encoding') ?? '');
    payload = validatePayload(JSON.parse(raw));
  } catch (err) {
    // A rejected upload is logged too. A phone whose payload the server refuses
    // looks identical, from the phone's side, to one that is not syncing -- and
    // the Sync page has to be able to tell those apart.
    const message = err instanceof Error ? err.message : 'invalid-payload';
    try {
      const guess = JSON.parse(raw) as { deviceId?: unknown };
      if (typeof guess?.deviceId === 'string') {
        logAndroidSync(guess.deviceId, 'rejected', { error: message });
      }
    } catch { /* unparseable body; nothing to attribute it to */ }
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  try {
    const out = ingestAndroid(payload);
    logAndroidSync(payload.deviceId, 'success', {
      bucketsSent: payload.buckets.length,
      rowsWritten: out.written,
      rowsUpdated: out.updated,
      appsSent: out.apps,
      oldest: out.oldest,
      newest: out.newest,
      appVersion: payload.appVersion,
    });
    return NextResponse.json({
      ok: true,
      written: out.written,
      updated: out.updated,
      apps: out.apps,
      oldest: out.oldest,
      newest: out.newest,
      // The phone uses this to advance its watermark, so it only ever uploads
      // buckets newer than what actually landed.
      acceptedThrough: out.newest,
    });
  } catch (err) {
    // The full message goes to the sync log, where the Sync page shows it. The
    // caller gets a code: this is a database error, and its text (paths,
    // SQLite internals) says nothing the phone can act on.
    const message = err instanceof Error ? err.message : 'ingest-failed';
    logAndroidSync(payload.deviceId, 'rejected', {
      bucketsSent: payload.buckets.length, error: message,
    });
    return NextResponse.json({ ok: false, error: 'ingest-failed' }, { status: 500 });
  }
}

/**
 * A reachability check for the app's "Test connection" button.
 *
 * Same token, no side effects. Without it the only way to find out whether the
 * URL and token are right is to attempt a real upload, and a failure then
 * cannot distinguish "wrong address" from "bad payload".
 */
export async function GET(request: Request) {
  const token = configuredToken();
  if (!token) return unauthorised('ingest-not-configured');

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented || !(await safeEqual(presented, token))) {
    return unauthorised('bad-token');
  }
  return NextResponse.json({ ok: true, database: databaseReady() });
}
