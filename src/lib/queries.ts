import 'server-only';

/**
 * Every read the dashboard performs. Server-side only -- `node:sqlite` is a
 * Node builtin and never reaches the browser.
 *
 * The one rule that governs this whole file:
 *
 *   TOTALS come from is_aggregate = 1.
 *   PER-APP figures come from is_aggregate = 0.
 *   The two are NEVER added together.
 *
 * `app_id = 1` is SRUM's per-interface aggregate row, whose bytes equal the sum
 * of every named app in the same hour. Mixing them double-counts. See
 * docs/DESIGN.md, SRUM trap 3 -- and if a page ever shows roughly twice what
 * Windows reports, this is the first place to look.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveApp } from './app-name';
import { deviceSlug } from './nav';
import { assignColors, type AppColorMap } from './app-colors';
import { toLocalBuckets, type AppKind } from './srum';
import {
  coveredDays, eachDay, fillDays, isKnown, laterOf, quietDay, unknownDay,
  type DailyPoint, type DayRange,
} from './days';

export interface Scope {
  /** `l2_profile_id`, or null for every network. */
  profileId: string | null;
  /** Window length in days, counted back from the newest local_date present. */
  days: number;
}

interface DashboardConfig {
  databasePath: string;
  deviceLabel?: string;
  splitApp?: string | null;
}

/**
 * config/collector.json, read fresh on every call. This used to be parsed
 * separately by each function that needed one key. It is still re-read per
 * call rather than cached, so a config edit is picked up without a restart,
 * which matters for a server that runs for weeks.
 */
function readConfig(): DashboardConfig {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'config', 'collector.json'), 'utf8'),
  ) as DashboardConfig;
}

function dbPath(): string {
  return readConfig().databasePath;
}

/**
 * The app the Overview splits out from everything else, or null for none.
 *
 * `splitApp` in config/collector.json, as the dashboard displays the name
 * ("qBittorrent", "Steam"). It exists for a machine where one app dwarfs the
 * rest: a single total, or one bar chart including it, flattens every other
 * app into invisibility. It is a setting because which app that is -- if any
 * -- is a fact about one machine, not about the project. Unset, the card
 * does not appear.
 */
export function splitAppName(): string | null {
  try {
    const name = readConfig().splitApp;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * What this machine is called.
 *
 * From `config/collector.json`, so the two places that show it -- the sidebar
 * and the Overview title -- cannot drift, and renaming the laptop is a config
 * edit rather than a code change. The Android side reads the equivalent from
 * the phone; Windows has nothing to read, and a hostname is rarely what a
 * person calls their machine.
 */
export function deviceLabel(): string {
  try {
    return readConfig().deviceLabel?.trim() || 'This PC';
  } catch {
    return 'This PC';
  }
}

export interface WindowsDevice {
  /** URL segment, and the name of this device's folder under `apps_logo/`. */
  slug: string;
  label: string;
}

/**
 * The laptop, as a device the routing layer can address.
 *
 * The shape deliberately matches what `getAndroidDevices()` returns for a
 * phone, because everything downstream -- the sidebar, the page tabs, the logo
 * folder, the detail links -- now takes a device rather than special-casing
 * Windows.
 *
 * There is exactly one, and it is not read from the database: the collector
 * snapshots THIS machine's own SRUM, so a second Windows device could only
 * appear by copying someone else's database in. That is why this returns a
 * device and not a list.
 */
export function windowsDevice(): WindowsDevice {
  const label = deviceLabel();
  return { slug: deviceSlug(label), label };
}

/** Shorthand for the logo folder and the URL segment. */
export function windowsSlug(): string {
  return windowsDevice().slug;
}

/**
 * Resolve a URL slug back to the laptop, or null when it matches nothing.
 *
 * Mirrors `deviceBySlug()` on the Android side, and exists for the same reason:
 * a pasted or stale URL naming a device that is not here must render "not
 * found", not this machine's numbers under someone else's name. It matters more
 * here than it looks, because the slug comes from an editable config label --
 * after a rename, every old bookmark carries the previous slug.
 */
export function windowsDeviceBySlug(slug: string): WindowsDevice | null {
  const device = windowsDevice();
  return device.slug === slug ? device : null;
}

export function databaseExists(): boolean {
  try {
    return existsSync(dbPath());
  } catch {
    return false;
  }
}

/**
 * Open read-only, per request.
 *
 * Not pooled: the collector writes to this file on a schedule, and holding a
 * long-lived handle across a WAL checkpoint is how you end up serving stale
 * pages. Opening costs well under a millisecond.
 */
function open(): DatabaseSync {
  return new DatabaseSync(dbPath(), { readOnly: true });
}

function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const db = open();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Build the shared `WHERE` fragment + params for a scope, plus the first day it
 * admits, which the daily series start from.
 */
function scopeClause(
  db: DatabaseSync, scope: Scope,
): { sql: string; params: string[]; from: string } {
  const newest =
    (db.prepare('SELECT MAX(local_date) d FROM usage_records').get() as { d: string | null })
      .d ?? new Date().toISOString().slice(0, 10);

  // Window anchors on the newest data present, not on today. If the collector
  // has been broken for a week, "last 30 days" should still show 30 days of
  // real data rather than silently shrinking -- the Sync page is what surfaces
  // the staleness.
  const since = new Date(newest + 'T00:00:00Z');
  since.setUTCDate(since.getUTCDate() - (scope.days - 1));
  const sinceStr = since.toISOString().slice(0, 10);

  const params: string[] = [sinceStr];
  let sql = 'local_date >= ?';
  if (scope.profileId) {
    sql += ' AND l2_profile_id = ?';
    params.push(scope.profileId);
  }
  return { sql, params, from: sinceStr };
}

/**
 * The local days SRUM is KNOWN to have held, from every successful collector
 * run's recorded window.
 *
 * On these days, no aggregate rows means the laptop moved nothing -- it was
 * off, asleep, or (under a network scope) on another network. Measured
 * 2026-09-21: the three empty days, Aug 28, Aug 29 and Sep 19, all sit inside
 * windows later runs read in full, and no collector ran on any of them. The
 * windows overlap run to run, so on a healthy install they merge into one
 * range from the first collection on.
 *
 * Outside them nothing is known. That is before the first collection, or a
 * stretch SRUM dropped before any run read it -- a collector down for longer
 * than SRUM's retention, the reset case this project exists for. Those days
 * stay null in the series and "no data collected" in the heat map, so a gap
 * shows as a gap. See `days.ts`.
 *
 * `toLocalBuckets` is the same rule the ingest used to assign `local_date`, so
 * a window's edges land on the same days its rows did.
 */
function collectedDays(db: DatabaseSync): DayRange[] {
  const runs = db
    .prepare(
      `SELECT srum_oldest_utc oldest, srum_newest_utc newest FROM sync_log
       WHERE status = 'success' AND srum_oldest_utc IS NOT NULL AND srum_newest_utc IS NOT NULL`,
    )
    .all() as { oldest: string; newest: string }[];
  return coveredDays(runs, (d) => toLocalBuckets(d).localDate);
}

/**
 * First to newest day of the laptop's history, unscoped: the span every daily
 * series is drawn over, so a network scope does not shift the axis.
 */
function laptopSpan(db: DatabaseSync): DayRange | null {
  const r = db
    .prepare('SELECT MIN(local_date) a, MAX(local_date) b FROM usage_records WHERE is_aggregate = 1')
    .get() as { a: string | null; b: string | null };
  return r.a && r.b ? { first: r.a, last: r.b } : null;
}

/** A day-by-day series from `from` to the newest day: quiet as 0, unknown as null. */
function filledDaily(db: DatabaseSync, rows: DailyPoint[], from: string): DailyPoint[] {
  const span = laptopSpan(db);
  if (!span) return [];
  return fillDays(rows, laterOf(from, span.first), span.last, collectedDays(db), quietDay, unknownDay);
}

export interface Totals {
  sent: number;
  received: number;
  total: number;
}

const EMPTY: Totals = { sent: 0, received: 0, total: 0 };

function totalsRow(r: { s: number | null; r: number | null } | undefined): Totals {
  const sent = Number(r?.s ?? 0);
  const received = Number(r?.r ?? 0);
  return { sent, received, total: sent + received };
}

/** Total stored rows, ignoring scope. Distinguishes an empty database from an
 *  empty selection -- the two need very different messages. */
export function getRowCount(): number {
  return withDb(
    (db) => Number((db.prepare('SELECT COUNT(*) c FROM usage_records').get() as { c: number }).c),
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export interface OverviewData {
  today: Totals;
  week: Totals;
  month: Totals;
  /** Every day held, ignoring the range selector. Still honours the network scope. */
  all: Totals;
  /** What "all" actually covers, so the card can say so rather than implying forever. */
  coverage: { first: string; last: string; days: number } | null;
  /** Heaviest single day in the scope window, for the trend chart's callout. */
  peak: { date: string; total: number } | null;
  /**
   * Daily aggregate series over the scope window, one entry per day: quiet days
   * as 0, days SRUM was never read for as null. See `collectedDays`.
   */
  daily: DailyPoint[];
  /**
   * The configured split app vs everything else, over the scope window.
   * `app` is null when no `splitApp` is configured; see `splitAppName()`.
   */
  split: { app: string | null; focus: number; other: number };
  latestDate: string | null;
  /** Mean daily total over days that have data, for spotting spikes. */
  meanDaily: number;
}

export function getOverview(scope: Scope): OverviewData {
  return withDb((db) => {
    const newest =
      (db.prepare('SELECT MAX(local_date) d FROM usage_records').get() as { d: string | null }).d;
    if (!newest) {
      return {
        today: EMPTY, week: EMPTY, month: EMPTY, all: EMPTY, coverage: null,
        peak: null, daily: [], split: { app: null, focus: 0, other: 0 },
        latestDate: null, meanDaily: 0,
      };
    }

    const prof = scope.profileId ? ' AND l2_profile_id = ?' : '';
    const profParams = scope.profileId ? [scope.profileId] : [];

    // Totals always read the aggregate rows.
    const windowTotals = (fromDate: string): Totals =>
      totalsRow(
        db
          .prepare(
            `SELECT SUM(bytes_sent) s, SUM(bytes_received) r FROM usage_records
             WHERE is_aggregate = 1 AND local_date >= ?${prof}`,
          )
          .get(fromDate, ...profParams) as { s: number | null; r: number | null },
      );

    const back = (n: number): string => {
      const d = new Date(newest + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };

    const today = windowTotals(newest);
    const week = windowTotals(back(6));
    const month = windowTotals(back(29));

    // Days with rows only; `daily` fills the rest. The mean and the peak are
    // read off these, so a day the laptop was off neither lowers the bar for
    // "well above trend" nor counts as a day of use.
    const rowDays = (
      db
        .prepare(
          `SELECT local_date d, SUM(bytes_sent) s, SUM(bytes_received) r
           FROM usage_records WHERE is_aggregate = 1 AND ${scopeClause(db, scope).sql}
           GROUP BY local_date ORDER BY local_date`,
        )
        .all(...scopeClause(db, scope).params) as { d: string; s: number; r: number }[]
    ).map((x) => ({
      date: x.d,
      sent: Number(x.s),
      received: Number(x.r),
      total: Number(x.s) + Number(x.r),
    }));
    const daily = filledDaily(db, rowDays, scopeClause(db, scope).from);

    // The split uses PER-APP rows, since it is a breakdown of named traffic.
    // It will therefore total slightly less than the headline figure; the
    // difference is the unattributed remainder.
    const focusApp = splitAppName();
    const sc = scopeClause(db, scope);
    const perApp = db
      .prepare(
        `SELECT app_identity i, app_kind k, SUM(bytes_sent + bytes_received) b
         FROM usage_records WHERE is_aggregate = 0 AND ${sc.sql}
         GROUP BY app_identity, app_kind`,
      )
      .all(...sc.params) as { i: string; k: string; b: number }[];

    let focus = 0;
    let other = 0;
    for (const row of perApp) {
      const { displayName } = resolveApp(row.i, row.k as AppKind);
      if (focusApp !== null && displayName === focusApp) focus += Number(row.b);
      else other += Number(row.b);
    }

    const meanDaily = rowDays.length
      ? rowDays.reduce((a, d) => a + d.total, 0) / rowDays.length
      : 0;

    // All-time, deliberately ignoring scope.days: the "All" card answers "how
    // much history do we actually hold", which the range selector must not
    // change. It still honours the network scope, so it agrees with its
    // neighbours.
    const all = totalsRow(
      db
        .prepare(
          `SELECT SUM(bytes_sent) s, SUM(bytes_received) r FROM usage_records
           WHERE is_aggregate = 1${prof}`,
        )
        .get(...profParams) as { s: number | null; r: number | null },
    );

    const cov = db
      .prepare(
        `SELECT MIN(local_date) a, MAX(local_date) b, COUNT(DISTINCT local_date) d
         FROM usage_records WHERE is_aggregate = 1${prof}`,
      )
      .get(...profParams) as { a: string | null; b: string | null; d: number };

    const peak = rowDays.reduce<{ date: string; total: number } | null>(
      (best, d) => (best === null || d.total > best.total ? { date: d.date, total: d.total } : best),
      null,
    );

    return {
      today, week, month, all,
      coverage: cov.a && cov.b ? { first: cov.a, last: cov.b, days: Number(cov.d) } : null,
      peak, daily, split: { app: focusApp, focus, other }, latestDate: newest, meanDaily,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Heat map                                                            */
/* ------------------------------------------------------------------ */

export interface HeatmapDay {
  date: string;
  total: number;
}

/**
 * Daily totals for the activity heat map.
 *
 * Deliberately ignores the page's day-range selector: the heat map always shows
 * a fixed six months, which is its whole point. It DOES honour the network
 * scope, so it agrees with the rest of the page.
 *
 * The component draws a day it is not given as "no data collected", and a day
 * given as 0 as quiet. So this returns days with rows, plus 0 for every day SRUM
 * is known to have held (`collectedDays`) -- and nothing for a day it never
 * held, because colouring that as quiet would invent history. It used to
 * return rows only, which drew the laptop's three switched-off days, and every
 * day spent on another network under a scope, as never collected.
 */
export function getHeatmap(profileId: string | null): HeatmapDay[] {
  return withDb((db) => {
    const since = new Date();
    since.setDate(since.getDate() - 26 * 7);
    const sinceStr = since.toISOString().slice(0, 10);

    const prof = profileId ? ' AND l2_profile_id = ?' : '';
    const params: (string | number)[] = profileId ? [sinceStr, profileId] : [sinceStr];

    const totals = new Map(
      (
        db
          .prepare(
            `SELECT local_date d, SUM(bytes_sent + bytes_received) b
             FROM usage_records
             WHERE is_aggregate = 1 AND local_date >= ?${prof}
             GROUP BY local_date`,
          )
          .all(...params) as { d: string; b: number }[]
      ).map((r) => [r.d, Number(r.b)]),
    );

    const span = laptopSpan(db);
    if (!span) return [];
    const known = collectedDays(db);
    return eachDay(laterOf(sinceStr, span.first), span.last)
      .filter((date) => totals.has(date) || isKnown(date, known))
      .map((date) => ({ date, total: totals.get(date) ?? 0 }));
  });
}

/* ------------------------------------------------------------------ */
/* By app                                                             */
/* ------------------------------------------------------------------ */

export interface AppRow {
  key: string;
  name: string;
  kind: AppKind;
  sent: number;
  received: number;
  total: number;
  share: number;
  rows: number;
  /** Distinct local days this app moved any bytes on. */
  days: number;
  /** Whether it earns a detail page. See `earnsDetailPage`. */
  detailed: boolean;
}

/**
 * Does this app deserve a page of its own?
 *
 * Hundreds of apps appear in the data and most are noise -- an installer that
 * ran once, a service that moved a few kilobytes. A detail page shows behaviour *over time*, so the
 * question is not "is this app important" but "is there a shape to look at".
 *
 * Two independent ways to qualify, because there are two kinds of interesting:
 *
 * - **Volume.** It moved real data, however briefly. A model download can pull
 *   gigabytes in two days; that is worth a page even though it has almost no
 *   time series.
 * - **Persistence.** It is always quietly running. A certificate service may
 *   move only megabytes, but across weeks -- that IS a shape, and the daily
 *   chart is the only place it shows.
 *
 * Deliberately excluded by both: one-shot installers, whose page would be one
 * bar.
 *
 * In practice a few dozen apps qualify, and they carry nearly all the traffic.
 *
 * Applied to the GROUPED app, never a raw identity -- two versions of one
 * packaged app are one app, and it is the app that is judged.
 */
const DETAIL_MIN_BYTES = 250 * 1024 * 1024;
const DETAIL_MIN_DAYS = 7;
const DETAIL_PERSISTENT_MIN_BYTES = 10 * 1024 * 1024;

export function earnsDetailPage(totalBytes: number, activeDays: number): boolean {
  if (totalBytes >= DETAIL_MIN_BYTES) return true;
  return activeDays >= DETAIL_MIN_DAYS && totalBytes >= DETAIL_PERSISTENT_MIN_BYTES;
}

export interface ByAppData {
  apps: AppRow[];
  namedTotal: number;
  /** Aggregate total minus named total: real traffic we cannot attribute. */
  unattributed: number;
  headlineTotal: number;
}

export function getByApp(scope: Scope): ByAppData {
  return withDb((db) => {
    const sc = scopeClause(db, scope);

    const raw = db
      .prepare(
        `SELECT app_identity i, app_kind k,
                SUM(bytes_sent) s, SUM(bytes_received) r, COUNT(*) n
         FROM usage_records WHERE is_aggregate = 0 AND ${sc.sql}
         GROUP BY app_identity, app_kind`,
      )
      .all(...sc.params) as { i: string; k: string; s: number; r: number; n: number }[];

    // Distinct days must be counted per GROUP, not summed per identity: two
    // versions of one app share days, and adding their counts double-counts.
    const dayRows = db
      .prepare(
        `SELECT DISTINCT app_identity i, app_kind k, local_date d
         FROM usage_records WHERE is_aggregate = 0 AND ${sc.sql}`,
      )
      .all(...sc.params) as { i: string; k: string; d: string }[];

    const daysByGroup = new Map<string, Set<string>>();
    for (const row of dayRows) {
      const { groupKey } = resolveApp(row.i, row.k as AppKind);
      const set = daysByGroup.get(groupKey) ?? new Set<string>();
      set.add(row.d);
      daysByGroup.set(groupKey, set);
    }

    // Fold identity strings into real applications. This is where versioned
    // install directories, versioned AppX packages and versioned service names
    // collapse back into one entry each -- without it, one app shows up several
    // times, each looking smaller than it is.
    const grouped = new Map<string, AppRow>();
    for (const row of raw) {
      const { groupKey, displayName, kind } = resolveApp(row.i, row.k as AppKind);
      const cur = grouped.get(groupKey) ?? {
        key: groupKey, name: displayName, kind,
        sent: 0, received: 0, total: 0, share: 0, rows: 0,
        days: 0, detailed: false,
      };
      cur.sent += Number(row.s);
      cur.received += Number(row.r);
      cur.total = cur.sent + cur.received;
      cur.rows += Number(row.n);
      grouped.set(groupKey, cur);
    }

    const headline = totalsRow(
      db
        .prepare(
          `SELECT SUM(bytes_sent) s, SUM(bytes_received) r FROM usage_records
           WHERE is_aggregate = 1 AND ${sc.sql}`,
        )
        .get(...sc.params) as { s: number | null; r: number | null },
    ).total;

    const apps = [...grouped.values()].sort((a, b) => b.total - a.total);
    const namedTotal = apps.reduce((a, x) => a + x.total, 0);
    for (const a of apps) {
      a.share = namedTotal ? (a.total / namedTotal) * 100 : 0;
      a.days = daysByGroup.get(a.key)?.size ?? 0;
      a.detailed = earnsDetailPage(a.total, a.days);
    }

    return {
      apps,
      namedTotal,
      unattributed: Math.max(0, headline - namedTotal),
      headlineTotal: headline,
    };
  });
}

/* ------------------------------------------------------------------ */
/* One app                                                             */
/* ------------------------------------------------------------------ */

export interface AppDetail {
  key: string;
  name: string;
  kind: AppKind;
  totals: Totals;
  /** Share of all attributed traffic in the same scope. */
  share: number;
  days: number;
  rows: number;
  first: string | null;
  last: string | null;
  peak: { date: string; total: number } | null;
  /** One per day in range; 0 on a collected day this app was quiet, null if never collected. */
  daily: DailyPoint[];
  hourly: { hour: number; sent: number; received: number; total: number }[];
  /** Per network, so a VPN or hotspot session stands out. */
  networks: { id: string; label: string; bytes: number }[];
  /** The raw SRUM strings this app was assembled from. */
  identities: { identity: string; kind: string; bytes: number }[];
  /**
   * The distinct programs merged into this app, largest first.
   *
   * One level up from `identities`: those are raw strings (one per installed
   * version), these are the programs a person would name -- "Claude Code" and
   * "Claude Desktop" inside "Claude". Length 1 means nothing was merged.
   */
  members: { key: string; name: string; bytes: number; days: number }[];
}

/**
 * Does this app exist anywhere in the database, ignoring scope?
 *
 * Lets the detail page tell "no such app" (a 404) apart from "this app moved
 * nothing in the selected window" (widen the range). Reporting the second for
 * the first sends the reader hunting for a date range that would never help.
 */
export function appExists(groupKey: string): boolean {
  return withDb((db) => {
    const raw = db
      .prepare(
        `SELECT DISTINCT app_identity i, app_kind k
         FROM usage_records WHERE is_aggregate = 0`,
      )
      .all() as { i: string; k: string }[];
    return raw.some((x) => resolveApp(x.i, x.k as AppKind).groupKey === groupKey);
  });
}

/**
 * Everything the detail page needs for one grouped app.
 *
 * Grouping happens in JS rather than SQL because `resolveApp` is where the
 * versioned-path, versioned-AppX and service-alias rules live -- SQL cannot
 * know that two install directories are one program.
 */
export function getAppDetail(groupKey: string, scope: Scope): AppDetail | null {
  return withDb((db) => {
    const sc = scopeClause(db, scope);

    const raw = db
      .prepare(
        `SELECT app_identity i, app_kind k,
                SUM(bytes_sent) s, SUM(bytes_received) r, COUNT(*) n
         FROM usage_records WHERE is_aggregate = 0 AND ${sc.sql}
         GROUP BY app_identity, app_kind`,
      )
      .all(...sc.params) as { i: string; k: string; s: number; r: number; n: number }[];

    const mine = raw.filter((x) => resolveApp(x.i, x.k as AppKind).groupKey === groupKey);
    if (mine.length === 0) return null;

    const first = mine[0]!;
    const resolved = resolveApp(first.i, first.k as AppKind);

    const identities = mine
      .map((x) => ({ identity: x.i, kind: x.k, bytes: Number(x.s) + Number(x.r) }))
      .sort((a, b) => b.bytes - a.bytes);

    // Fold the raw identities back up one level, to the programs a person would
    // name. Active days must be counted per member rather than summed, for the
    // same reason the app table counts them per group: two installed versions
    // of one program share days.
    const memberDays = new Map<string, Set<string>>();
    for (const row of db
      .prepare(
        `SELECT DISTINCT app_identity i, app_kind k, local_date d
         FROM usage_records WHERE is_aggregate = 0 AND ${sc.sql}`,
      )
      .all(...sc.params) as { i: string; k: string; d: string }[]) {
      const r = resolveApp(row.i, row.k as AppKind);
      if (r.groupKey !== groupKey) continue;
      const set = memberDays.get(r.memberKey) ?? new Set<string>();
      set.add(row.d);
      memberDays.set(r.memberKey, set);
    }

    const byMember = new Map<string, { key: string; name: string; bytes: number; days: number }>();
    for (const x of mine) {
      const r = resolveApp(x.i, x.k as AppKind);
      const cur = byMember.get(r.memberKey)
        ?? { key: r.memberKey, name: r.memberName, bytes: 0, days: 0 };
      cur.bytes += Number(x.s) + Number(x.r);
      byMember.set(r.memberKey, cur);
    }
    const members = [...byMember.values()]
      .map((m) => ({ ...m, days: memberDays.get(m.key)?.size ?? 0 }))
      .sort((a, b) => b.bytes - a.bytes);

    const sent = mine.reduce((a, x) => a + Number(x.s), 0);
    const received = mine.reduce((a, x) => a + Number(x.r), 0);
    const rows = mine.reduce((a, x) => a + Number(x.n), 0);

    // Bind the identity list into the remaining queries rather than filtering in
    // JS: these series can span tens of thousands of rows.
    const ids = mine.map((x) => x.i);
    const placeholders = ids.map(() => '?').join(',');

    // Days this app moved data. `days`, `first`, `last` and `peak` are read off
    // these, never off the filled series: `earnsDetailPage` and the page's
    // per-day figure both mean ACTIVE days.
    const rowDays = (
      db
        .prepare(
          `SELECT local_date d, SUM(bytes_sent) s, SUM(bytes_received) r
           FROM usage_records
           WHERE is_aggregate = 0 AND app_identity IN (${placeholders}) AND ${sc.sql}
           GROUP BY local_date ORDER BY local_date`,
        )
        .all(...ids, ...sc.params) as { d: string; s: number; r: number }[]
    ).map((x) => ({
      date: x.d,
      sent: Number(x.s),
      received: Number(x.r),
      total: Number(x.s) + Number(x.r),
    }));
    const daily = filledDaily(db, rowDays, sc.from);

    const hourly = (
      db
        .prepare(
          `SELECT local_hour h, SUM(bytes_sent) s, SUM(bytes_received) r
           FROM usage_records
           WHERE is_aggregate = 0 AND app_identity IN (${placeholders}) AND ${sc.sql}
           GROUP BY local_hour ORDER BY local_hour`,
        )
        .all(...ids, ...sc.params) as { h: number; s: number; r: number }[]
    ).map((x) => ({
      hour: Number(x.h),
      sent: Number(x.s),
      received: Number(x.r),
      total: Number(x.s) + Number(x.r),
    }));

    // Same disambiguation the scope bar uses: without the suffix every
    // still-unnamed profile renders as a bare "Wi-Fi", and a five-row table of
    // identical labels tells the reader nothing.
    const profileNames = new Map(
      getProfiles().map((p) => [p.id, p.named ? p.label : `${p.label}, unnamed`]),
    );
    const networks = (
      db
        .prepare(
          `SELECT l2_profile_id p, SUM(bytes_sent + bytes_received) b
           FROM usage_records
           WHERE is_aggregate = 0 AND app_identity IN (${placeholders}) AND ${sc.sql}
           GROUP BY l2_profile_id ORDER BY b DESC`,
        )
        .all(...ids, ...sc.params) as { p: string; b: number }[]
    )
      .filter((x) => x.p && x.p !== '0')
      .map((x) => ({ id: x.p, label: profileNames.get(x.p) ?? 'Unknown network', bytes: Number(x.b) }));

    const attributed = db
      .prepare(
        `SELECT SUM(bytes_sent + bytes_received) b FROM usage_records
         WHERE is_aggregate = 0 AND ${sc.sql}`,
      )
      .get(...sc.params) as { b: number | null };

    const total = sent + received;
    const peak = rowDays.reduce<{ date: string; total: number } | null>(
      (best, d) => (best === null || d.total > best.total ? { date: d.date, total: d.total } : best),
      null,
    );

    return {
      key: groupKey,
      name: resolved.displayName,
      kind: resolved.kind,
      totals: { sent, received, total },
      share: attributed.b ? (total / Number(attributed.b)) * 100 : 0,
      days: rowDays.length,
      rows,
      first: rowDays.length ? rowDays[0]!.date : null,
      last: rowDays.length ? rowDays[rowDays.length - 1]!.date : null,
      peak,
      daily,
      hourly,
      networks,
      identities,
      members,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Timeline                                                           */
/* ------------------------------------------------------------------ */

export interface TimelinePoint {
  date: string;
  /** Bytes per series; null on a day SRUM was never read for. */
  [app: string]: string | number | null;
}

export interface TimelineData {
  points: TimelinePoint[];
  /** Series names, largest first, with 'Other' last when present. */
  series: string[];
  hourly: { hour: number; sent: number; received: number; total: number }[];
}

export function getTimeline(scope: Scope, topN = 8): TimelineData {
  return withDb((db) => {
    const sc = scopeClause(db, scope);

    const raw = db
      .prepare(
        `SELECT local_date d, app_identity i, app_kind k,
                SUM(bytes_sent + bytes_received) b
         FROM usage_records WHERE is_aggregate = 0 AND ${sc.sql}
         GROUP BY local_date, app_identity, app_kind`,
      )
      .all(...sc.params) as { d: string; i: string; k: string; b: number }[];

    const totalByApp = new Map<string, number>();
    const perDay = new Map<string, Map<string, number>>();

    for (const row of raw) {
      const { displayName } = resolveApp(row.i, row.k as AppKind);
      const bytes = Number(row.b);
      totalByApp.set(displayName, (totalByApp.get(displayName) ?? 0) + bytes);
      const day = perDay.get(row.d) ?? new Map<string, number>();
      day.set(displayName, (day.get(displayName) ?? 0) + bytes);
      perDay.set(row.d, day);
    }

    const top = [...totalByApp.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([name]) => name);
    const topSet = new Set(top);
    const hasOther = totalByApp.size > top.length;

    const rowPoints: TimelinePoint[] = [...perDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, apps]) => {
        const point: TimelinePoint = { date };
        for (const name of top) point[name] = apps.get(name) ?? 0;
        if (hasOther) {
          let other = 0;
          for (const [name, b] of apps) if (!topSet.has(name)) other += b;
          point['Other'] = other;
        }
        return point;
      });

    // One point per day, like the trend above it: 0 across the stack on a day
    // SRUM held and nothing moved, null on a day it never held -- which
    // Recharts draws as a break in every band rather than a slope across it.
    const series = hasOther ? [...top, 'Other'] : top;
    const every = (value: 0 | null) => (date: string): TimelinePoint =>
      Object.fromEntries([['date', date], ...series.map((s) => [s, value])]) as TimelinePoint;
    const span = laptopSpan(db);
    const points = span
      ? fillDays(rowPoints, laterOf(sc.from, span.first), span.last, collectedDays(db), every(0), every(null))
      : [];

    const hourly = (
      db
        .prepare(
          `SELECT local_hour h, SUM(bytes_sent) s, SUM(bytes_received) r
           FROM usage_records WHERE is_aggregate = 1 AND ${sc.sql}
           GROUP BY local_hour ORDER BY local_hour`,
        )
        .all(...sc.params) as { h: number; s: number; r: number }[]
    ).map((x) => ({
      hour: Number(x.h),
      sent: Number(x.s),
      received: Number(x.r),
      total: Number(x.s) + Number(x.r),
    }));

    return { points, series, hourly };
  });
}

/* ------------------------------------------------------------------ */
/* Sync status                                                        */
/* ------------------------------------------------------------------ */

export interface SyncRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  rowsRead: number;
  rowsInserted: number;
  rowsSkipped: number;
  srumOldestUtc: string | null;
  srumNewestUtc: string | null;
  backupStatus: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface SyncData {
  /** One page of runs, newest first. */
  runs: SyncRun[];
  /** Every run ever logged, so the page can size its pagination. */
  totalRuns: number;
  lastSuccess: SyncRun | null;
  hoursSinceSuccess: number | null;
  totalRows: number;
  coverage: { first: string; last: string; days: number } | null;
  consecutiveFailures: number;
}

const RUN_COLUMNS = `id, started_at, finished_at, status, rows_read,
  rows_inserted, rows_skipped, srum_oldest_utc, srum_newest_utc, backup_status,
  duration_ms, error`;

function toRun(r: Record<string, unknown>): SyncRun {
  return {
    id: Number(r['id']),
    startedAt: String(r['started_at']),
    finishedAt: r['finished_at'] ? String(r['finished_at']) : null,
    status: String(r['status']),
    rowsRead: Number(r['rows_read'] ?? 0),
    rowsInserted: Number(r['rows_inserted'] ?? 0),
    rowsSkipped: Number(r['rows_skipped'] ?? 0),
    srumOldestUtc: r['srum_oldest_utc'] ? String(r['srum_oldest_utc']) : null,
    srumNewestUtc: r['srum_newest_utc'] ? String(r['srum_newest_utc']) : null,
    backupStatus: r['backup_status'] ? String(r['backup_status']) : null,
    durationMs: r['duration_ms'] == null ? null : Number(r['duration_ms']),
    error: r['error'] ? String(r['error']) : null,
  };
}

/**
 * Run history, one page at a time.
 *
 * `lastSuccess` and `consecutiveFailures` are queried across the WHOLE table,
 * never derived from the page. They used to be computed from whatever slice was
 * fetched, which was wrong in two ways: paging back would have reported the
 * last success *on that page*, and `getSync(1)` -- which Overview calls -- saw
 * only the newest run, so a single failed run made "collected X ago" vanish and
 * the stalled banner appear even though the previous run had succeeded minutes
 * earlier.
 */
export function getSync(limit = 30, offset = 0): SyncData {
  return withDb((db) => {
    const runs = (
      db
        .prepare(`SELECT ${RUN_COLUMNS} FROM sync_log ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(limit, offset) as Record<string, unknown>[]
    ).map((r): SyncRun => ({
      id: Number(r['id']),
      startedAt: String(r['started_at']),
      finishedAt: r['finished_at'] ? String(r['finished_at']) : null,
      status: String(r['status']),
      rowsRead: Number(r['rows_read'] ?? 0),
      rowsInserted: Number(r['rows_inserted'] ?? 0),
      rowsSkipped: Number(r['rows_skipped'] ?? 0),
      srumOldestUtc: r['srum_oldest_utc'] ? String(r['srum_oldest_utc']) : null,
      srumNewestUtc: r['srum_newest_utc'] ? String(r['srum_newest_utc']) : null,
      backupStatus: r['backup_status'] ? String(r['backup_status']) : null,
      durationMs: r['duration_ms'] == null ? null : Number(r['duration_ms']),
      error: r['error'] ? String(r['error']) : null,
    }));

    const totalRuns = Number(
      (db.prepare('SELECT COUNT(*) c FROM sync_log').get() as { c: number }).c,
    );

    const lastSuccessRow = db
      .prepare(`SELECT ${RUN_COLUMNS} FROM sync_log WHERE status = 'success' ORDER BY id DESC LIMIT 1`)
      .get() as Record<string, unknown> | undefined;
    const lastSuccess = lastSuccessRow ? toRun(lastSuccessRow) : null;

    // A run left at 'running' is either genuinely in flight (seconds) or a
    // relic: older backups were snapshotted before their own log row was
    // finalised, so a restored database can carry one permanently. Anything
    // older than an hour is the latter.
    const stale = runs.filter(
      (r) => r.status === 'running' &&
        Date.now() - new Date(r.startedAt).getTime() > 3_600_000,
    );
    for (const r of stale) r.status = 'interrupted';

    // Failures since the most recent success. This is the number that decides
    // whether the page shows an alarm: one failed run is noise, three in a row
    // means the schedule is broken and history is now accruing risk.
    const consecutiveFailures = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) c FROM sync_log
             WHERE status = 'failed'
               AND id > (SELECT COALESCE(MAX(id), 0) FROM sync_log WHERE status = 'success')`,
          )
          .get() as { c: number }
      ).c,
    );

    const totalRows = Number(
      (db.prepare('SELECT COUNT(*) c FROM usage_records').get() as { c: number }).c,
    );

    const cov = db
      .prepare(
        'SELECT MIN(local_date) a, MAX(local_date) b, COUNT(DISTINCT local_date) d FROM usage_records',
      )
      .get() as { a: string | null; b: string | null; d: number };

    return {
      runs,
      totalRuns,
      lastSuccess,
      hoursSinceSuccess: lastSuccess
        ? (Date.now() - new Date(lastSuccess.startedAt).getTime()) / 3_600_000
        : null,
      totalRows,
      coverage: cov.a && cov.b ? { first: cov.a, last: cov.b, days: Number(cov.d) } : null,
      consecutiveFailures,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Colours                                                            */
/* ------------------------------------------------------------------ */

/**
 * Canonical app -> colour assignment.
 *
 * Derived from ALL-TIME totals, deliberately ignoring the current scope, so an
 * app keeps its colour when the date range or the page changes. Ranking is what
 * makes the top apps mutually distinct; using all-time data is what makes the
 * ranking stable.
 */
export function getAppColorMap(): AppColorMap {
  return withDb((db) => {
    const rows = db
      .prepare(
        `SELECT app_identity i, app_kind k, SUM(bytes_sent + bytes_received) b
         FROM usage_records WHERE is_aggregate = 0
         GROUP BY app_identity, app_kind`,
      )
      .all() as { i: string; k: string; b: number }[];

    const totals = new Map<string, number>();
    for (const r of rows) {
      const { displayName } = resolveApp(r.i, r.k as AppKind);
      totals.set(displayName, (totals.get(displayName) ?? 0) + Number(r.b));
    }

    return assignColors(
      [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    );
  });
}

/* ------------------------------------------------------------------ */
/* Scope options                                                      */
/* ------------------------------------------------------------------ */

export interface ProfileOption {
  id: string;
  label: string;
  /** True when `label` is a real SSID rather than a fallback interface type. */
  named: boolean;
  /** Other SSIDs seen on this same profile id, most-voted first. */
  aliases: string[];
  bytes: number;
  interfaceType: string;
}

export function getProfiles(): ProfileOption[] {
  return withDb((db) => {
    // MAX(profile_name) picks up a real SSID from ANY row carrying one, which
    // matters because rows collected before the SOFTWARE hive was passed to
    // SrumECmd have it blank. One run with `-r` therefore names the whole
    // history for a profile, with no backfill.
    // Most-voted name per profile. One id can genuinely carry several SSIDs --
    // HomeWiFi and HomeWiFi_5G are separate WLAN profiles that SRUM
    // records under the SAME id -- so runner-up names are kept as aliases
    // rather than silently discarded, and the label stops flip-flopping.
    const named = new Map<string, { name: string; aliases: string[] }>();
    for (const r of db
      .prepare(
        `SELECT l2_profile_id p, name FROM network_names
         ORDER BY l2_profile_id, votes DESC, last_seen DESC`,
      )
      .all() as { p: string; name: string }[]) {
      const cur = named.get(r.p);
      if (!cur) named.set(r.p, { name: r.name, aliases: [] });
      else cur.aliases.push(r.name);
    }

    const rows = db
      .prepare(
        `SELECT l2_profile_id p, interface_type t,
                MAX(NULLIF(profile_name, '')) n,
                SUM(bytes_sent + bytes_received) b
         FROM usage_records WHERE is_aggregate = 0
         GROUP BY l2_profile_id, interface_type ORDER BY b DESC`,
      )
      .all() as { p: string; t: string; n: string | null; b: number }[];

    return rows
      .filter((r) => r.p && r.p !== '0')
      .map((r) => {
        const learned = named.get(r.p);
        // An observed name beats SRUM's own ProfileName column, which is empty
        // in practice; the interface type is the last resort.
        const fallback = r.n && r.n.trim() ? r.n.trim() : prettyInterface(r.t);
        return {
          id: r.p,
          label: learned ? learned.name : fallback,
          named: Boolean(learned) || Boolean(r.n && r.n.trim()),
          aliases: learned ? learned.aliases : [],
          bytes: Number(r.b),
          interfaceType: r.t,
        };
      });
  });
}

function prettyInterface(t: string): string {
  if (/IEEE80211/i.test(t)) return 'Wi-Fi';
  if (/ETHERNET/i.test(t)) return 'Ethernet';
  if (/WWANPP|MOBILE/i.test(t)) return 'Mobile';
  return t || 'Unknown';
}
