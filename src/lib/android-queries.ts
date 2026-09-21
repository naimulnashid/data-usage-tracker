import 'server-only';

/**
 * Every read the Android pages perform.
 *
 * Kept apart from `queries.ts` for the same reason the tables are kept apart:
 * a uid is not an exe path, a 2-hour bucket is not a 1-hour one, and the two
 * datasets must never be summed. Sharing a query module would make that
 * mistake one careless `UNION` away.
 *
 * The rule that governs this file:
 *
 *   **uid -5 is TETHERING, and it is already counted on the Windows side.**
 *
 * It is traffic the phone relayed for other devices -- including this PC, which
 * tethers off it. Those bytes appear again in `usage_records` under Windows app
 * names. So it is separated out everywhere, labelled, and never folded into
 * "apps". This is the Android analogue of the `AppId = 1` trap.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assignColors, type AppColorMap } from './app-colors';
import { deviceSlug } from './nav';
import {
  eachDay, fillDays, laterOf, quietDay, unknownDay, type DailyPoint, type DayRange,
} from './days';

/** Documented special uids. Anything else negative is surfaced as-is. */
export const UID_TETHERING = -5;
export const UID_REMOVED = -4;

function dbPath(): string {
  const cfg = JSON.parse(
    readFileSync(join(process.cwd(), 'config', 'collector.json'), 'utf8'),
  ) as { databasePath: string };
  return cfg.databasePath;
}

function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath(), { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function androidReady(): boolean {
  try {
    if (!existsSync(dbPath())) return false;
    return withDb((db) => {
      const t = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='android_usage_records'`)
        .get() as { name: string } | undefined;
      if (!t) return false;
      const n = db.prepare('SELECT COUNT(*) c FROM android_usage_records').get() as { c: number };
      return Number(n.c) > 0;
    });
  } catch {
    return false;
  }
}

export interface Totals { rx: number; tx: number; total: number }

function totalsOf(row: { rx: number | null; tx: number | null }): Totals {
  const rx = Number(row.rx ?? 0);
  const tx = Number(row.tx ?? 0);
  return { rx, tx, total: rx + tx };
}

export interface AndroidApp {
  uid: number;
  /** Best label for the uid. */
  name: string;
  /** How many packages share this uid; >1 means the label is one of several. */
  packages: number;
  /** uid / 100000. Non-zero means a cloned or work-profile app. */
  profile: number;
  rx: number;
  tx: number;
  total: number;
  share: number;
  days: number;
  special: boolean;
}

export interface AndroidOverview {
  latestDate: string | null;
  coverage: { first: string; last: string; days: number } | null;
  /** Apps only. Excludes tethering, which is counted on the Windows side. */
  all: Totals;
  month: Totals;
  week: Totals;
  today: Totals;
  byNetwork: { network: string; total: number }[];
  /** Every day of the range the phone's history covers, quiet days as 0. */
  daily: DailyPoint[];
  hourly: { hour: number; sent: number; received: number; total: number }[];
  apps: AndroidApp[];
  /** Relayed for other devices. Shown apart, never added to the above. */
  tethering: number;
  /** Mean over days that moved data, which is what the spike flag compares to. */
  meanDaily: number;
  peak: { date: string; total: number } | null;
}

/**
 * Resolve a uid to something a person can read.
 *
 * The label comes from the phone's own PackageManager, so there is no curated
 * name table on this side. A shared uid picks the first non-system package by
 * name and reports how many others there are, rather than silently choosing.
 */
function appNames(db: DatabaseSync, deviceId: string): Map<number, { name: string; packages: number }> {
  const rows = db
    .prepare(
      `SELECT uid, label, package, is_system FROM android_apps WHERE ${OF_DEVICE} ORDER BY is_system, package`,
    )
    .all(deviceId) as { uid: number; label: string; package: string; is_system: number }[];

  const out = new Map<number, { name: string; packages: number }>();
  for (const r of rows) {
    const uid = Number(r.uid);
    const cur = out.get(uid);
    if (!cur) out.set(uid, { name: r.label || r.package, packages: 1 });
    else cur.packages++;
  }
  return out;
}

function labelFor(
  uid: number,
  names: Map<number, { name: string; packages: number }>,
): { name: string; packages: number; special: boolean } {
  if (uid === UID_TETHERING) return { name: 'Tethering / hotspot', packages: 0, special: true };
  if (uid === UID_REMOVED) return { name: 'Uninstalled apps', packages: 0, special: true };
  const direct = names.get(uid);
  if (direct) return { ...direct, special: false };
  // A cloned app carries user profile 999 in its uid and is absent from the
  // package list under that number; fall back to the base appId.
  const base = names.get(uid % 100_000);
  if (base) return { name: `${base.name} (clone)`, packages: base.packages, special: false };
  if (uid < 0) return { name: `System uid ${uid}`, packages: 0, special: true };
  return { name: `uid ${uid}`, packages: 0, special: false };
}

/** `WHERE` fragment excluding tethering, used everywhere a total is computed. */
const NOT_TETHER = `uid != ${UID_TETHERING}`;

/**
 * Every query below is scoped to ONE device.
 *
 * There can be more than one phone, and with the filter missing they would all
 * report identical numbers at different URLs -- which looks like the routing is
 * broken rather than the query. `deviceId` is always the FIRST bound parameter,
 * so the argument order matches the clause order and stays checkable by eye.
 */
const OF_DEVICE = 'device_id = ?';

/**
 * The days this phone's history covers: its first to its last day with a row.
 *
 * Inside that span a day without rows moved nothing, and the daily series say
 * so with a 0 -- see `days.ts`. The span is contiguous by construction: the
 * first sync backfills everything Android still holds, and every later read
 * starts one bucket before the last one the server confirmed. A hole of LOST
 * data needs the phone unsynced for longer than Android's ~90-day retention,
 * which the Sync page has flagged as critical for a month by then
 * (`SYNC_CRITICAL_HOURS`).
 *
 * The span ends at the last row, not the last sync, because the phone's UTC
 * offset is not stored: a sync's timestamp cannot be turned into the phone's
 * local date. So an idle phone's quiet days after its last traffic are not
 * yet drawn as quiet.
 */
function phoneHistory(db: DatabaseSync, deviceId: string): DayRange | null {
  const r = db
    .prepare(`SELECT MIN(local_date) a, MAX(local_date) b FROM android_usage_records WHERE ${OF_DEVICE}`)
    .get(deviceId) as { a: string | null; b: string | null };
  return r.a && r.b ? { first: r.a, last: r.b } : null;
}

/** A day-by-day series over `[from, history.last]`, quiet days as 0. */
function filledDaily(rows: DailyPoint[], from: string, history: DayRange | null): DailyPoint[] {
  if (!history) return [];
  return fillDays(rows, laterOf(from, history.first), history.last, [history], quietDay, unknownDay);
}

export function getAndroidOverview(deviceId: string, days: number): AndroidOverview {
  return withDb((db) => {
    const newest = db
      .prepare(`SELECT MAX(local_date) d FROM android_usage_records WHERE ${OF_DEVICE}`)
      .get(deviceId) as { d: string | null };
    const latestDate = newest.d;

    const since = (n: number) =>
      latestDate
        ? new Date(new Date(`${latestDate}T00:00:00Z`).getTime() - (n - 1) * 86400000)
            .toISOString()
            .slice(0, 10)
        : '9999-12-31';

    const window = (from: string) =>
      totalsOf(
        db
          .prepare(
            `SELECT SUM(rx_bytes) rx, SUM(tx_bytes) tx FROM android_usage_records
             WHERE ${OF_DEVICE} AND ${NOT_TETHER} AND local_date >= ?`,
          )
          .get(deviceId, from) as { rx: number | null; tx: number | null },
      );

    const all = totalsOf(
      db
        .prepare(`SELECT SUM(rx_bytes) rx, SUM(tx_bytes) tx FROM android_usage_records WHERE ${OF_DEVICE} AND ${NOT_TETHER}`)
        .get(deviceId) as { rx: number | null; tx: number | null },
    );

    const cov = db
      .prepare(
        `SELECT MIN(local_date) a, MAX(local_date) b, COUNT(DISTINCT local_date) d
         FROM android_usage_records WHERE ${OF_DEVICE}`,
      )
      .get(deviceId) as { a: string | null; b: string | null; d: number };

    const scopeFrom = since(days);

    // rx and tx are carried, not just the total: the charts are shared with the
    // Windows pages and stack received under sent. Passing zeros for both
    // renders an empty chart, which is how this was found.
    //
    // Only days WITH rows come back from here; `daily` below fills the rest.
    const rowDays = (
      db
        .prepare(
          `SELECT local_date d, SUM(rx_bytes) rx, SUM(tx_bytes) tx FROM android_usage_records
           WHERE ${OF_DEVICE} AND ${NOT_TETHER} AND local_date >= ?
           GROUP BY local_date ORDER BY local_date`,
        )
        .all(deviceId, scopeFrom) as { d: string; rx: number; tx: number }[]
    ).map((r) => ({
      date: r.d,
      received: Number(r.rx),
      sent: Number(r.tx),
      total: Number(r.rx) + Number(r.tx),
    }));
    const daily = filledDaily(rowDays, scopeFrom, phoneHistory(db, deviceId));

    const hourly = (
      db
        .prepare(
          `SELECT local_hour h, SUM(rx_bytes) rx, SUM(tx_bytes) tx FROM android_usage_records
           WHERE ${OF_DEVICE} AND ${NOT_TETHER} AND local_date >= ?
           GROUP BY local_hour ORDER BY local_hour`,
        )
        .all(deviceId, scopeFrom) as { h: number; rx: number; tx: number }[]
    ).map((r) => ({
      hour: Number(r.h),
      received: Number(r.rx),
      sent: Number(r.tx),
      total: Number(r.rx) + Number(r.tx),
    }));

    const byNetwork = (
      db
        .prepare(
          `SELECT network n, SUM(rx_bytes + tx_bytes) b FROM android_usage_records
           WHERE ${OF_DEVICE} AND ${NOT_TETHER} AND local_date >= ?
           GROUP BY network ORDER BY b DESC`,
        )
        .all(deviceId, scopeFrom) as { n: string; b: number }[]
    ).map((r) => ({ network: r.n, total: Number(r.b) }));

    const names = appNames(db, deviceId);

    const rawApps = db
      .prepare(
        `SELECT uid, SUM(rx_bytes) rx, SUM(tx_bytes) tx, COUNT(DISTINCT local_date) days
         FROM android_usage_records WHERE ${OF_DEVICE} AND local_date >= ?
         GROUP BY uid ORDER BY SUM(rx_bytes + tx_bytes) DESC`,
      )
      .all(deviceId, scopeFrom) as { uid: number; rx: number; tx: number; days: number }[];

    const scopedNamed = rawApps
      .filter((r) => Number(r.uid) !== UID_TETHERING)
      .reduce((a, r) => a + Number(r.rx) + Number(r.tx), 0);

    const apps: AndroidApp[] = rawApps
      .filter((r) => Number(r.uid) !== UID_TETHERING)
      .map((r) => {
        const uid = Number(r.uid);
        const meta = labelFor(uid, names);
        const rx = Number(r.rx);
        const tx = Number(r.tx);
        return {
          uid,
          name: meta.name,
          packages: meta.packages,
          profile: uid > 0 ? Math.floor(uid / 100_000) : 0,
          rx,
          tx,
          total: rx + tx,
          share: scopedNamed ? ((rx + tx) / scopedNamed) * 100 : 0,
          days: Number(r.days),
          special: meta.special,
        };
      });

    const tethering = rawApps
      .filter((r) => Number(r.uid) === UID_TETHERING)
      .reduce((a, r) => a + Number(r.rx) + Number(r.tx), 0);

    // Over days that moved data, not the filled series: a phone used on 2 days
    // of 86 would otherwise have a mean so low that its only activity reads as
    // a spike, and red is reserved for genuine anomalies.
    const meanDaily = rowDays.length ? rowDays.reduce((a, d) => a + d.total, 0) / rowDays.length : 0;
    const peak = rowDays.reduce<{ date: string; total: number } | null>(
      (best, d) => (best === null || d.total > best.total ? d : best),
      null,
    );

    return {
      latestDate,
      coverage: cov.a && cov.b ? { first: cov.a, last: cov.b, days: Number(cov.d) } : null,
      all,
      month: window(since(30)),
      week: window(since(7)),
      today: window(since(1)),
      byNetwork,
      daily,
      hourly,
      apps,
      tethering,
      meanDaily,
      peak,
    };
  });
}

/**
 * Android's retention is what makes a late phone survivable.
 *
 * AOSP deletes per-uid history at 90 days (57 measured on this device at the
 * time of the phase-1 capture; the app's first backfill reached 92). So unlike
 * the Windows collector -- where a stopped task is invisible until a reset has
 * already destroyed the history -- a phone that has not reported for a week has
 * lost precisely nothing.
 *
 * The thresholds below say that honestly rather than borrowing the Windows
 * page's alarm. `WARN` is "this is later than the 6-hour schedule implies, go
 * and look"; `CRITICAL` is "you are now approaching the point where Android
 * starts deleting what has not been collected".
 */
export const SYNC_WARN_HOURS = 72;
export const SYNC_CRITICAL_HOURS = 60 * 24;
/** What Android is documented to keep. Used to say how much runway is left. */
export const RETENTION_DAYS = 90;

export interface AndroidSyncRun {
  receivedAt: string;
  status: string;
  bucketsSent: number;
  rowsWritten: number;
  rowsUpdated: number;
  error: string | null;
}

export interface AndroidSyncStatus {
  runs: AndroidSyncRun[];
  totalRuns: number;
  lastSuccessAt: string | null;
  hoursSinceSuccess: number | null;
  consecutiveFailures: number;
  /** Newest bucket the server actually holds, which is what matters. */
  newestBucket: string | null;
  oldestBucket: string | null;
  records: number;
  apps: number;
  days: number;
  /**
   * Days of Android's ~90-day window still un-collected if nothing syncs.
   * Negative would mean history has already been lost.
   */
  runwayDays: number | null;
}

export function getAndroidSyncStatus(deviceId: string, limit = 25, offset = 0): AndroidSyncStatus {
  return withDb((db) => {
    const runs = (
      db
        .prepare(
          `SELECT received_at r, status s, buckets_sent b, rows_written w,
                  rows_updated u, error e
           FROM android_sync_log WHERE ${OF_DEVICE} ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(deviceId, limit, offset) as {
        r: string; s: string; b: number; w: number; u: number; e: string | null;
      }[]
    ).map((x) => ({
      receivedAt: x.r,
      status: x.s,
      bucketsSent: Number(x.b),
      rowsWritten: Number(x.w),
      rowsUpdated: Number(x.u),
      error: x.e,
    }));

    const totalRuns = Number(
      (db.prepare(`SELECT COUNT(*) c FROM android_sync_log WHERE ${OF_DEVICE}`).get(deviceId) as { c: number }).c,
    );

    const lastOk = db
      .prepare(`SELECT received_at r FROM android_sync_log WHERE ${OF_DEVICE} AND status = 'success' ORDER BY id DESC LIMIT 1`)
      .get(deviceId) as { r: string } | undefined;

    // Counted from the newest run backwards, so one failure followed by a
    // success reads as recovered rather than as an outstanding problem.
    const recent = db
      .prepare(`SELECT status s FROM android_sync_log WHERE ${OF_DEVICE} ORDER BY id DESC LIMIT 40`)
      .all(deviceId) as { s: string }[];
    let consecutiveFailures = 0;
    for (const r of recent) {
      if (r.s === 'success') break;
      consecutiveFailures++;
    }

    const span = db
      .prepare(
        `SELECT MIN(bucket_start_utc) a, MAX(bucket_start_utc) b,
                COUNT(*) c, COUNT(DISTINCT local_date) d
         FROM android_usage_records WHERE ${OF_DEVICE}`,
      )
      .get(deviceId) as { a: string | null; b: string | null; c: number; d: number };

    const apps = Number(
      (db.prepare(`SELECT COUNT(DISTINCT uid) c FROM android_usage_records WHERE ${OF_DEVICE}`).get(deviceId) as { c: number }).c,
    );

    const hoursSinceSuccess = lastOk
      ? (Date.now() - new Date(lastOk.r).getTime()) / 3_600_000
      : null;

    // How long the phone can stay away before Android deletes something that
    // was never collected. Measured from the NEWEST stored bucket, not from the
    // last upload: an upload that stored nothing new bought no runway.
    const runwayDays = span.b
      ? RETENTION_DAYS - (Date.now() - new Date(span.b).getTime()) / 86_400_000
      : null;

    return {
      runs,
      totalRuns,
      lastSuccessAt: lastOk?.r ?? null,
      hoursSinceSuccess,
      consecutiveFailures,
      newestBucket: span.b,
      oldestBucket: span.a,
      records: Number(span.c),
      apps,
      days: Number(span.d),
      runwayDays,
    };
  });
}

/**
 * Hours since the phone's last SUCCESSFUL upload, for the "collected 4h ago"
 * line on the overview.
 *
 * Deliberately its own one-row query rather than a call to
 * `getAndroidSyncStatus`, which runs six to answer questions -- runway, run
 * history, record counts -- that the overview does not ask.
 *
 * Scoped to `status = 'success'` for the same reason the Sync Status page is:
 * a rejected upload collected nothing, so counting it would report the phone
 * as current at the exact moment it had stopped reporting.
 */
export function getAndroidLastSuccess(
  deviceId: string,
): { at: string; hoursAgo: number } | null {
  return withDb((db) => {
    const row = db
      .prepare(
        `SELECT received_at r FROM android_sync_log
         WHERE ${OF_DEVICE} AND status = 'success' ORDER BY id DESC LIMIT 1`,
      )
      .get(deviceId) as { r: string } | undefined;

    if (!row) return null;
    return { at: row.r, hoursAgo: (Date.now() - new Date(row.r).getTime()) / 3_600_000 };
  });
}

/* ------------------------------------------------------------------ */
/* Heat map                                                            */
/* ------------------------------------------------------------------ */

export interface AndroidHeatmapDay { date: string; total: number }

/**
 * Daily totals for the whole recorded history, ignoring the range selector.
 *
 * The heat map's job is to show the shape of months at a glance; scoping it to
 * the current range would leave it mostly empty and say nothing the trend chart
 * above it does not already say better. Same decision as the Windows side.
 */
export function getAndroidHeatmap(deviceId: string): AndroidHeatmapDay[] {
  return withDb((db) => {
    const totals = new Map(
      (
        db
          .prepare(
            `SELECT local_date d, SUM(rx_bytes + tx_bytes) b FROM android_usage_records
             WHERE ${OF_DEVICE} AND ${NOT_TETHER} GROUP BY local_date`,
          )
          .all(deviceId) as { d: string; b: number }[]
      ).map((r) => [r.d, Number(r.b)]),
    );
    // Every day of the phone's history, quiet ones as 0. The component draws a
    // day it is not given as "no data collected", which is right before the
    // history begins and wrong inside it: one phone showed 84 idle days as
    // never collected.
    const history = phoneHistory(db, deviceId);
    if (!history) return [];
    return eachDay(history.first, history.last)
      .map((date) => ({ date, total: totals.get(date) ?? 0 }));
  });
}

/* ------------------------------------------------------------------ */
/* Colours                                                             */
/* ------------------------------------------------------------------ */

/**
 * Per-app colours for the phone, ranked by ALL-TIME bytes.
 *
 * Same contract as the Windows map, for the same reason: ranking on all-time
 * data is what keeps an app's colour stable when the range or the page changes.
 *
 * Brand colours in `app-colors.ts` are keyed by display name, and the phone's
 * own labels ("YouTube", "Telegram", "Brave", "Chrome") match them directly --
 * so the Android side gets brand colour for free wherever one is known, with no
 * Android-specific mapping at all.
 */
export function getAndroidAppColorMap(deviceId: string): AppColorMap {
  return withDb((db) => {
    const names = appNames(db, deviceId);
    const rows = db
      .prepare(
        `SELECT uid, SUM(rx_bytes + tx_bytes) b FROM android_usage_records
         WHERE ${OF_DEVICE} AND ${NOT_TETHER} GROUP BY uid ORDER BY b DESC`,
      )
      .all(deviceId) as { uid: number; b: number }[];
    return assignColors(rows.map((r) => labelFor(Number(r.uid), names).name));
  });
}

/* ------------------------------------------------------------------ */
/* Daily by app                                                        */
/* ------------------------------------------------------------------ */

export interface AndroidTimeline {
  /** One per day of the phone's history in range; quiet days carry 0s. */
  points: ({ date: string } & Record<string, string | number | null>)[];
  series: string[];
}

/**
 * Top-N apps per day, everything else folded into "Other".
 *
 * Ranked over the scoped window rather than all time, so the band that
 * dominates the picture is the one that dominated the period being looked at.
 */
export function getAndroidTimeline(deviceId: string, days: number, topN = 8): AndroidTimeline {
  return withDb((db) => {
    const newest = (
      db.prepare(`SELECT MAX(local_date) d FROM android_usage_records WHERE ${OF_DEVICE}`).get(deviceId) as { d: string | null }
    ).d;
    if (!newest) return { points: [], series: [] };
    const from = new Date(new Date(`${newest}T00:00:00Z`).getTime() - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);

    const names = appNames(db, deviceId);
    const rows = db
      .prepare(
        `SELECT local_date d, uid, SUM(rx_bytes + tx_bytes) b FROM android_usage_records
         WHERE ${OF_DEVICE} AND ${NOT_TETHER} AND local_date >= ?
         GROUP BY local_date, uid`,
      )
      .all(deviceId, from) as { d: string; uid: number; b: number }[];

    const totalByApp = new Map<string, number>();
    const perDay = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const name = labelFor(Number(r.uid), names).name;
      const b = Number(r.b);
      totalByApp.set(name, (totalByApp.get(name) ?? 0) + b);
      const day = perDay.get(r.d) ?? new Map<string, number>();
      day.set(name, (day.get(name) ?? 0) + b);
      perDay.set(r.d, day);
    }

    const top = [...totalByApp.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([nm]) => nm);
    const topSet = new Set(top);
    const hasOther = totalByApp.size > top.length;

    type Point = AndroidTimeline['points'][number];
    const rowPoints = [...perDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, apps]) => {
        const point: Point = { date };
        for (const name of top) point[name] = apps.get(name) ?? 0;
        if (hasOther) {
          let other = 0;
          for (const [name, b] of apps) if (!topSet.has(name)) other += b;
          point['Other'] = other;
        }
        return point;
      });

    const series = hasOther ? [...top, 'Other'] : top;
    const history = phoneHistory(db, deviceId);
    const every = (value: 0 | null) => (date: string): Point =>
      Object.fromEntries([['date', date], ...series.map((s) => [s, value])]) as Point;
    const points = history
      ? fillDays(rowPoints, laterOf(from, history.first), history.last, [history], every(0), every(null))
      : [];

    return { points, series };
  });
}

/* ------------------------------------------------------------------ */
/* One app                                                             */
/* ------------------------------------------------------------------ */

/**
 * Does this uid deserve a page of its own?
 *
 * Hundreds of uids appear and most are system services moving kilobytes. Same two-way
 * test as the Windows side -- volume OR persistence -- because the same two
 * kinds of thing are worth a page: something that moved real data briefly, and
 * something that has been quietly running for months.
 *
 * The thresholds are lower than the Windows ones because a phone moves less
 * than a busy laptop: 250 MB is a rounding error there and a real app
 * here.
 */
const DETAIL_MIN_BYTES = 100 * 1024 * 1024;
const DETAIL_MIN_DAYS = 14;
const DETAIL_PERSISTENT_MIN_BYTES = 5 * 1024 * 1024;

export function earnsAndroidDetailPage(totalBytes: number, activeDays: number): boolean {
  if (totalBytes >= DETAIL_MIN_BYTES) return true;
  return activeDays >= DETAIL_MIN_DAYS && totalBytes >= DETAIL_PERSISTENT_MIN_BYTES;
}

export interface AndroidPackage {
  packageName: string;
  label: string;
  isSystem: boolean;
}

export interface AndroidAppDetail {
  uid: number;
  name: string;
  profile: number;
  special: boolean;
  totals: Totals;
  share: number;
  days: number;
  first: string | null;
  last: string | null;
  peak: { date: string; total: number } | null;
  /** Every day of the phone's history in range; days this uid was quiet are 0. */
  daily: DailyPoint[];
  hourly: { hour: number; sent: number; received: number; total: number }[];
  byNetwork: { network: string; total: number }[];
  /** Every package sharing this uid. Length > 1 is the interesting case. */
  packages: AndroidPackage[];
}

/** Ignores scope: does this uid exist in the data at all? */
export function androidAppExists(deviceId: string, uid: number): boolean {
  return withDb((db) => {
    const r = db
      .prepare(`SELECT 1 x FROM android_usage_records WHERE ${OF_DEVICE} AND uid = ? LIMIT 1`)
      .get(deviceId, uid) as { x: number } | undefined;
    return Boolean(r);
  });
}

/**
 * Everything one uid's page needs.
 *
 * Returns null only when the uid is unknown entirely. A uid that exists but
 * moved nothing in the selected range returns zeroed totals instead, so the
 * page can say "nothing in this range" rather than 404-ing on an app that is
 * plainly there -- the same distinction the Windows detail page makes.
 */
export function getAndroidAppDetail(deviceId: string, uid: number, days: number): AndroidAppDetail | null {
  return withDb((db) => {
    const newest = (
      db.prepare(`SELECT MAX(local_date) d FROM android_usage_records WHERE ${OF_DEVICE}`).get(deviceId) as { d: string | null }
    ).d;
    if (!newest) return null;

    const exists = db
      .prepare(`SELECT 1 x FROM android_usage_records WHERE ${OF_DEVICE} AND uid = ? LIMIT 1`)
      .get(deviceId, uid) as { x: number } | undefined;
    if (!exists) return null;

    const from = new Date(new Date(`${newest}T00:00:00Z`).getTime() - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);

    const totals = totalsOf(
      db
        .prepare(
          `SELECT SUM(rx_bytes) rx, SUM(tx_bytes) tx FROM android_usage_records
           WHERE ${OF_DEVICE} AND uid = ? AND local_date >= ?`,
        )
        .get(deviceId, uid, from) as { rx: number | null; tx: number | null },
    );

    // Days this uid moved data. `days`, `first`, `last` and `peak` are read off
    // these, never off the filled series: the page's eligibility gate and its
    // per-day figure both mean ACTIVE days.
    const rowDays = (
      db
        .prepare(
          `SELECT local_date d, SUM(rx_bytes) rx, SUM(tx_bytes) tx FROM android_usage_records
           WHERE ${OF_DEVICE} AND uid = ? AND local_date >= ? GROUP BY local_date ORDER BY local_date`,
        )
        .all(deviceId, uid, from) as { d: string; rx: number; tx: number }[]
    ).map((r) => ({
      date: r.d,
      received: Number(r.rx),
      sent: Number(r.tx),
      total: Number(r.rx) + Number(r.tx),
    }));
    const daily = filledDaily(rowDays, from, phoneHistory(db, deviceId));

    const hourly = (
      db
        .prepare(
          `SELECT local_hour h, SUM(rx_bytes) rx, SUM(tx_bytes) tx FROM android_usage_records
           WHERE ${OF_DEVICE} AND uid = ? AND local_date >= ? GROUP BY local_hour ORDER BY local_hour`,
        )
        .all(deviceId, uid, from) as { h: number; rx: number; tx: number }[]
    ).map((r) => ({
      hour: Number(r.h),
      received: Number(r.rx),
      sent: Number(r.tx),
      total: Number(r.rx) + Number(r.tx),
    }));

    const byNetwork = (
      db
        .prepare(
          `SELECT network n, SUM(rx_bytes + tx_bytes) b FROM android_usage_records
           WHERE ${OF_DEVICE} AND uid = ? AND local_date >= ? GROUP BY network ORDER BY b DESC`,
        )
        .all(deviceId, uid, from) as { n: string; b: number }[]
    ).map((r) => ({ network: r.n, total: Number(r.b) }));

    const packages = (
      db
        .prepare(
          `SELECT package p, label l, is_system s FROM android_apps
           WHERE ${OF_DEVICE} AND uid = ? ORDER BY is_system, package`,
        )
        .all(deviceId, uid) as { p: string; l: string; s: number }[]
    ).map((r) => ({ packageName: r.p, label: r.l, isSystem: Number(r.s) === 1 }));

    const scopedTotal = Number(
      (
        db
          .prepare(
            `SELECT SUM(rx_bytes + tx_bytes) b FROM android_usage_records
             WHERE ${OF_DEVICE} AND ${NOT_TETHER} AND local_date >= ?`,
          )
          .get(deviceId, from) as { b: number | null }
      ).b ?? 0,
    );

    const names = appNames(db, deviceId);
    const meta = labelFor(uid, names);
    const peak = rowDays.reduce<{ date: string; total: number } | null>(
      (best, d) => (best === null || d.total > best.total ? { date: d.date, total: d.total } : best),
      null,
    );

    return {
      uid,
      name: meta.name,
      profile: uid > 0 ? Math.floor(uid / 100_000) : 0,
      special: meta.special,
      totals,
      share: scopedTotal ? (totals.total / scopedTotal) * 100 : 0,
      days: rowDays.length,
      first: rowDays.length ? rowDays[0]!.date : null,
      last: rowDays.length ? rowDays[rowDays.length - 1]!.date : null,
      peak,
      daily,
      hourly,
      byNetwork,
      packages,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Devices and their URLs                                              */
/* ------------------------------------------------------------------ */

/*
 * `deviceSlug` used to live here. It moved to `lib/nav.ts` when the laptop got
 * a slug of its own: both halves derive one the same way, and neither owns the
 * rule. Re-exported so the Android call sites read as they always did.
 */
export { deviceSlug };

export interface AndroidDeviceSummary {
  deviceId: string;
  slug: string;
  label: string;
  release: string;
  sdk: number;
  lastSeen: string;
  total: number;
}

/**
 * Every phone that has ever reported, largest first.
 *
 * Ordered by bytes rather than by name so the sidebar leads with the device
 * that actually matters, the same way the network list does.
 */
export function getAndroidDevices(): AndroidDeviceSummary[] {
  if (!androidReady()) return [];
  return withDb((db) => {
    const totals = new Map<string, number>();
    for (const r of db
      .prepare(
        `SELECT device_id d, SUM(rx_bytes + tx_bytes) b FROM android_usage_records
         WHERE ${OF_DEVICE} AND ${NOT_TETHER} GROUP BY device_id`,
      )
      .all() as { d: string; b: number }[]) {
      totals.set(r.d, Number(r.b));
    }

    const rows = db
      .prepare(
        `SELECT device_id d, label l, android_release r, sdk s, last_seen seen
         FROM android_devices`,
      )
      .all() as { d: string; l: string; r: string; s: number; seen: string }[];

    const seen = new Map<string, number>();
    return rows
      .map((x) => {
        // Two phones of the same model would otherwise collide on one slug and
        // silently share a page. Suffix the duplicates rather than dropping one.
        const base = deviceSlug(x.l || x.d);
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return {
          deviceId: x.d,
          slug: n === 1 ? base : `${base}-${n}`,
          label: x.l || x.d,
          release: x.r,
          sdk: Number(x.s),
          lastSeen: x.seen,
          total: totals.get(x.d) ?? 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  });
}

/** Resolve a URL slug back to a device, or null when it matches nothing. */
export function deviceBySlug(slug: string): AndroidDeviceSummary | null {
  return getAndroidDevices().find((d) => d.slug === slug) ?? null;
}

/* ------------------------------------------------------------------ */
/* Which Wi-Fi network (collected over adb)                            */
/* ------------------------------------------------------------------ */

export interface SsidTotal { ssid: string; total: number }

export interface SsidBreakdown {
  networks: SsidTotal[];
  /** Sum of the above. */
  attributed: number;
  /** When `scripts/android-ssid-collect.ts` last ran, ISO, or null. */
  lastCollected: string | null;
  /**
   * The app's Wi-Fi total for the same window.
   *
   * Kept beside the SSID figures rather than reconciled with them: they come
   * from different sources with different coverage, and the gap is meaningful.
   * See `unattributed`.
   */
  wifiTotal: number;
  /**
   * Wi-Fi bytes with no SSID against them, i.e. traffic that crossed a VPN.
   *
   * A VPN network is reported on a stacked ident carrying no `wifiNetworkKey`,
   * so it is absent from the SSID data by construction. Surfacing the
   * remainder is honest; silently scaling the SSID figures up to match would
   * invent an attribution nobody has.
   *
   * **Compared only over the days the SSID capture actually covers.** The two
   * sources have different reach: the app's `querySummary` walked back 92 days
   * on one device while `dumpsys` retained 58, so subtracting one whole-range
   * total from the other reported many times the real "VPN" figure -- Wi-Fi
   * predating the capture. See `coverage`.
   */
  unattributed: number;
  /** The days the SSID capture covers, which bounds every figure above. */
  coverage: { first: string; last: string } | null;
  /** True when the selected range reaches back further than the capture does. */
  rangeExceedsCoverage: boolean;
}

export function getSsidBreakdown(deviceId: string, days: number): SsidBreakdown {
  return withDb((db) => {
    const has = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='android_ssid_usage'`)
      .get() as { name: string } | undefined;
    if (!has) {
      return {
        networks: [], attributed: 0, lastCollected: null, wifiTotal: 0,
        unattributed: 0, coverage: null, rangeExceedsCoverage: false,
      };
    }

    const newest = (
      db.prepare(`SELECT MAX(local_date) d FROM android_usage_records WHERE ${OF_DEVICE}`)
        .get(deviceId) as { d: string | null }
    ).d;
    const requestedFrom = newest
      ? new Date(new Date(`${newest}T00:00:00Z`).getTime() - (days - 1) * 86400000)
          .toISOString().slice(0, 10)
      : '9999-12-31';

    // What the capture actually holds. Everything below is clamped to it,
    // because comparing a 92-day app total against a 58-day capture is what
    // once reported about thirty times the real VPN traffic.
    const cov = db
      .prepare(
        `SELECT MIN(local_date) a, MAX(local_date) b FROM android_ssid_usage
         WHERE ${OF_DEVICE} AND ${NOT_TETHER}`,
      )
      .get(deviceId) as { a: string | null; b: string | null };

    if (!cov.a || !cov.b) {
      return {
        networks: [], attributed: 0, lastCollected: null, wifiTotal: 0,
        unattributed: 0, coverage: null, rangeExceedsCoverage: false,
      };
    }

    const from = requestedFrom > cov.a ? requestedFrom : cov.a;
    const to = cov.b;

    const networks = (
      db
        .prepare(
          `SELECT ssid, SUM(rx_bytes + tx_bytes) b FROM android_ssid_usage
           WHERE ${OF_DEVICE} AND ${NOT_TETHER} AND local_date >= ? AND local_date <= ?
           GROUP BY ssid ORDER BY b DESC`,
        )
        .all(deviceId, from, to) as { ssid: string; b: number }[]
    )
      .map((r) => ({ ssid: r.ssid, total: Number(r.b) }))
      .filter((r) => r.total > 0);

    const attributed = networks.reduce((a, r) => a + r.total, 0);

    const wifiTotal = Number(
      (db
        .prepare(
          `SELECT SUM(rx_bytes + tx_bytes) b FROM android_usage_records
           WHERE ${OF_DEVICE} AND ${NOT_TETHER} AND network = 'wifi'
             AND local_date >= ? AND local_date <= ?`,
        )
        .get(deviceId, from, to) as { b: number | null }).b ?? 0,
    );

    // This device's own capture date. The key used to be global, so every
    // phone's card showed whichever phone was captured last. A capture made
    // before the per-device key existed falls back to the newest row that
    // capture wrote for THIS device -- the script stamps every row it writes
    // with the same instant, so that is the capture time exactly (verified
    // against both phones captured on 2026-09-04).
    const last = (
      db.prepare(`SELECT value FROM meta WHERE key = ?`)
        .get(`android_ssid_last_collect:${deviceId}`) as { value: string } | undefined
    )?.value ?? (
      db.prepare(`SELECT MAX(ingested_at) v FROM android_ssid_usage WHERE ${OF_DEVICE}`)
        .get(deviceId) as { v: string | null }
    ).v;

    return {
      networks,
      attributed,
      lastCollected: last ?? null,
      wifiTotal,
      unattributed: Math.max(0, wifiTotal - attributed),
      coverage: { first: from, last: to },
      rangeExceedsCoverage: requestedFrom < cov.a,
    };
  });
}

/** The same breakdown for one app. */
export function getSsidForUid(deviceId: string, uid: number, days: number): SsidTotal[] {
  return withDb((db) => {
    const has = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='android_ssid_usage'`)
      .get() as { name: string } | undefined;
    if (!has) return [];

    const newest = (
      db.prepare(`SELECT MAX(local_date) d FROM android_usage_records WHERE ${OF_DEVICE}`)
        .get(deviceId) as { d: string | null }
    ).d;
    if (!newest) return [];
    const from = new Date(new Date(`${newest}T00:00:00Z`).getTime() - (days - 1) * 86400000)
      .toISOString().slice(0, 10);

    return (
      db
        .prepare(
          `SELECT ssid, SUM(rx_bytes + tx_bytes) b FROM android_ssid_usage
           WHERE ${OF_DEVICE} AND uid = ? AND local_date >= ?
           GROUP BY ssid ORDER BY b DESC`,
        )
        .all(deviceId, uid, from) as { ssid: string; b: number }[]
    )
      .map((r) => ({ ssid: r.ssid, total: Number(r.b) }))
      .filter((r) => r.total > 0);
  });
}
