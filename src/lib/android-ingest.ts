/**
 * Writing an upload from the phone into SQLite.
 *
 * Split from the route handler so the logic is testable without HTTP, the same
 * way `ingest.ts` is testable without a real SRUM snapshot. That is also why
 * this module does NOT carry `server-only`, unlike `queries.ts`: the package
 * throws on import outside a React Server Component, which would take the
 * self-test with it. The protection is not lost -- it imports `node:sqlite`
 * through `db.ts`, so a client bundle cannot include it either way.
 *
 * The one rule that governs this file, and the biggest behavioural difference
 * from the Windows collector:
 *
 *   **A NetworkStats bucket is a running total, not an immutable delta.**
 *
 * SRUM writes a row per hour and never touches it again, so identical bytes
 * mean a duplicate and the byte values belong in the dedup key. A NetworkStats
 * bucket accumulates across its 2-hour window: query it at 10:30 and you get a
 * partial figure, query it again at 11:30 and you get a larger one for the same
 * key. `INSERT OR IGNORE` would keep the partial figure forever; putting bytes
 * in the key would store both and double-count the overlap. So this upserts,
 * and takes the larger of the two.
 */

import { readFileSync, existsSync } from 'node:fs';
import { configPath } from './config-path';
import { openDatabase } from './db';

/* ------------------------------------------------------------------ */
/* Payload                                                             */
/* ------------------------------------------------------------------ */

export interface AndroidApp {
  uid: number;
  package: string;
  label: string;
  isSystem: boolean;
}

export interface AndroidBucket {
  uid: number;
  /** Bucket start, epoch milliseconds UTC. */
  start: number;
  /** 'wifi' | 'mobile'. */
  network: string;
  metered: boolean;
  roaming: boolean;
  rx: number;
  tx: number;
}

export interface AndroidPayload {
  deviceId: string;
  label?: string;
  brand?: string;
  model?: string;
  release?: string;
  sdk?: number;
  appVersion?: string;
  /**
   * The device's UTC offset in minutes at upload time, used to derive
   * local_date / local_hour.
   *
   * Sent by the phone rather than taken from the server, because the phone is
   * the machine whose day boundaries the reader cares about -- and it may not
   * be in the server's timezone. Same reasoning as the Windows side computing
   * local buckets from the collecting machine's offset.
   */
  utcOffsetMinutes: number;
  apps: AndroidApp[];
  buckets: AndroidBucket[];
}

export interface IngestOutcome {
  written: number;
  updated: number;
  apps: number;
  oldest: string | null;
  newest: string | null;
}

const NETWORKS = new Set(['wifi', 'mobile']);

/**
 * How far ahead of the server's clock a bucket may start. A phone's clock can
 * run fast, and its current bucket legitimately starts up to two hours ago in
 * ITS time -- so the margin is generous. What it rules out is a timestamp that
 * no clock skew explains, which would anchor every chart's "latest day" in the
 * future.
 */
const MAX_FUTURE_MS = 2 * 24 * 60 * 60 * 1000;

/** Every string the phone sends is rendered somewhere; none has cause to be long. */
function optionalText(value: unknown, field: string, max: number): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`${field} must be a string of at most ${max} characters`);
  }
}

/**
 * Throws with a readable reason rather than writing something half-valid.
 *
 * The endpoint is behind a bearer token, so whoever reaches this holds it; the
 * checks are there because a token on a phone is the kind of secret that ends
 * up somewhere unexpected, and because a buggy build of the app should be
 * turned away rather than stored. Until 2026-09-21 only the buckets were
 * checked -- the app list and the device strings went into the database
 * unexamined.
 */
export function validatePayload(body: unknown, now: number = Date.now()): AndroidPayload {
  const p = body as Partial<AndroidPayload>;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('body must be an object');
  if (typeof p.deviceId !== 'string' || p.deviceId.length < 8 || p.deviceId.length > 128) {
    throw new Error('deviceId must be a string of 8-128 characters');
  }
  if (!Number.isInteger(p.utcOffsetMinutes) || Math.abs(p.utcOffsetMinutes as number) > 15 * 60) {
    throw new Error('utcOffsetMinutes out of range');
  }
  optionalText(p.label, 'label', 128);
  optionalText(p.brand, 'brand', 128);
  optionalText(p.model, 'model', 128);
  optionalText(p.release, 'release', 32);
  optionalText(p.appVersion, 'appVersion', 64);
  if (p.sdk !== undefined && (!Number.isInteger(p.sdk) || p.sdk < 0 || p.sdk > 1000)) {
    throw new Error('sdk must be an integer API level');
  }
  if (!Array.isArray(p.apps) || !Array.isArray(p.buckets)) {
    throw new Error('apps and buckets must be arrays');
  }
  // A phone with three months of 2-hour buckets across 128 uids and two
  // networks is on the order of 100k rows; the cap is a guard against a
  // runaway client, not a real limit. The same for apps: the busiest phone
  // here reports 242.
  if (p.buckets.length > 400_000) throw new Error('too many buckets in one upload');
  if (p.apps.length > 20_000) throw new Error('too many apps in one upload');

  for (const a of p.apps) {
    if (!a || typeof a !== 'object') throw new Error('each app must be an object');
    if (!Number.isInteger(a.uid)) throw new Error('app.uid must be an integer');
    if (typeof a.package !== 'string' || a.package.length === 0 || a.package.length > 256) {
      throw new Error('app.package must be a string of 1-256 characters');
    }
    optionalText(a.label, 'app.label', 256);
  }

  for (const b of p.buckets) {
    if (!b || typeof b !== 'object') throw new Error('each bucket must be an object');
    if (!Number.isInteger(b.uid)) throw new Error('bucket.uid must be an integer');
    if (!Number.isInteger(b.start) || b.start < 1_000_000_000_000) throw new Error('bucket.start must be epoch ms');
    if (b.start > now + MAX_FUTURE_MS) throw new Error('bucket.start is in the future');
    if (!NETWORKS.has(b.network)) throw new Error(`bucket.network must be one of ${[...NETWORKS].join(', ')}`);
    if (!Number.isSafeInteger(b.rx) || !Number.isSafeInteger(b.tx) || b.rx < 0 || b.tx < 0) {
      throw new Error('bucket.rx and bucket.tx must be non-negative integers');
    }
  }
  return p as AndroidPayload;
}

/* ------------------------------------------------------------------ */
/* Local-time bucketing                                                */
/* ------------------------------------------------------------------ */

/**
 * Epoch ms -> the phone's local date and hour.
 *
 * Deliberately arithmetic rather than `toLocaleString`: the server's timezone
 * is irrelevant here and letting it participate is how the Windows side's
 * equivalent bug would have looked -- days shifted by the offset, with nothing
 * on screen to say why.
 */
export function localParts(epochMs: number, offsetMinutes: number): { date: string; hour: number } {
  const shifted = new Date(epochMs + offsetMinutes * 60_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
  };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

export function databasePath(): string {
  const cfg = JSON.parse(readFileSync(configPath(), 'utf8')) as { databasePath: string };
  return cfg.databasePath;
}

export function databaseReady(): boolean {
  try { return existsSync(databasePath()); } catch { return false; }
}

/**
 * Test seam. The self-test points these at a throwaway database in TEMP.
 *
 * `allowSystemDrive` is threaded through rather than defaulted, because
 * `openDatabase` refuses a path under C:\ and that guard is the one thing in
 * this project that must never be bypassed by accident.
 */
export interface IngestOptions {
  dbPath?: string;
  allowSystemDrive?: boolean;
}

/**
 * Open read-write for the duration of one upload.
 *
 * Goes through `openDatabase` rather than opening the file directly, so the
 * system-drive guard, the schema and the schema_version row all apply here
 * exactly as they do for the Windows collector. It also means a phone upload
 * can be what creates the android_* tables on a database written before they
 * existed.
 *
 * Short-lived and never pooled: the Windows collector holds the same file.
 * `busy_timeout` covers a phone upload landing on top of a 03:30 collection --
 * rare, but a phone that retries all day will eventually meet one.
 */
function open(opts: IngestOptions = {}) {
  const db = openDatabase(opts.dbPath ?? databasePath(), {
    allowSystemDrive: opts.allowSystemDrive,
  });
  db.exec('PRAGMA busy_timeout = 8000;');
  return db;
}

export function ingestAndroid(payload: AndroidPayload, opts: IngestOptions = {}): IngestOutcome {
  const db = open(opts);
  const now = new Date().toISOString();

  try {
    const upsertDevice = db.prepare(`
      INSERT INTO android_devices
        (device_id, label, brand, model, android_release, sdk, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        label = excluded.label, brand = excluded.brand, model = excluded.model,
        android_release = excluded.android_release, sdk = excluded.sdk,
        last_seen = excluded.last_seen
    `);

    const upsertApp = db.prepare(`
      INSERT INTO android_apps
        (device_id, uid, package, label, is_system, user_profile, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id, uid, package) DO UPDATE SET
        label = excluded.label, is_system = excluded.is_system, last_seen = excluded.last_seen
    `);

    // The upsert that makes this whole file behave. MAX(), not assignment: an
    // upload that happens to carry an older partial reading for a bucket the
    // database already has complete must not shrink it.
    const upsertBucket = db.prepare(`
      INSERT INTO android_usage_records
        (device_id, uid, bucket_start_utc, local_date, local_hour,
         network, metered, roaming, rx_bytes, tx_bytes, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id, uid, bucket_start_utc, network, metered, roaming)
      DO UPDATE SET
        rx_bytes    = MAX(rx_bytes, excluded.rx_bytes),
        tx_bytes    = MAX(tx_bytes, excluded.tx_bytes),
        ingested_at = excluded.ingested_at
      WHERE excluded.rx_bytes > rx_bytes OR excluded.tx_bytes > tx_bytes
    `);

    const countBefore = db
      .prepare('SELECT COUNT(*) c FROM android_usage_records WHERE device_id = ?')
      .get(payload.deviceId) as { c: number };

    let touched = 0;
    let oldest: string | null = null;
    let newest: string | null = null;

    db.exec('BEGIN');
    try {
      upsertDevice.run(
        payload.deviceId,
        payload.label ?? `${payload.brand ?? ''} ${payload.model ?? ''}`.trim(),
        payload.brand ?? '', payload.model ?? '',
        payload.release ?? '', payload.sdk ?? 0,
        now, now,
      );

      for (const a of payload.apps) {
        upsertApp.run(
          payload.deviceId, a.uid, a.package, a.label ?? '',
          a.isSystem ? 1 : 0, Math.floor(a.uid / 100_000), now, now,
        );
      }

      for (const b of payload.buckets) {
        const iso = new Date(b.start).toISOString();
        const { date, hour } = localParts(b.start, payload.utcOffsetMinutes);
        const res = upsertBucket.run(
          payload.deviceId, b.uid, iso, date, hour,
          b.network, b.metered ? 1 : 0, b.roaming ? 1 : 0,
          b.rx, b.tx, now,
        );
        if (Number(res.changes) > 0) touched++;
        if (oldest === null || iso < oldest) oldest = iso;
        if (newest === null || iso > newest) newest = iso;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const countAfter = db
      .prepare('SELECT COUNT(*) c FROM android_usage_records WHERE device_id = ?')
      .get(payload.deviceId) as { c: number };

    // `changes` cannot tell an insert from an update, so the split is derived
    // from the row count. It is only ever reported, never acted on.
    const written = Number(countAfter.c) - Number(countBefore.c);

    return {
      written,
      updated: Math.max(0, touched - written),
      apps: payload.apps.length,
      oldest,
      newest,
    };
  } finally {
    db.close();
  }
}

export function logAndroidSync(
  deviceId: string,
  status: 'success' | 'rejected',
  fields: Partial<{
    bucketsSent: number; rowsWritten: number; rowsUpdated: number; appsSent: number;
    oldest: string | null; newest: string | null; appVersion: string; error: string;
  }>,
  opts: IngestOptions = {},
): void {
  const db = open(opts);
  try {
    db.prepare(`
      INSERT INTO android_sync_log
        (device_id, received_at, status, buckets_sent, rows_written, rows_updated,
         apps_sent, oldest_bucket, newest_bucket, app_version, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deviceId, new Date().toISOString(), status,
      fields.bucketsSent ?? 0, fields.rowsWritten ?? 0, fields.rowsUpdated ?? 0,
      fields.appsSent ?? 0, fields.oldest ?? null, fields.newest ?? null,
      fields.appVersion ?? null, fields.error ?? null,
    );
  } finally {
    db.close();
  }
}
