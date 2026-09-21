/**
 * Writes a synthetic usage history for the demo dashboard the README's
 * screenshots are taken from.
 *
 *   npm run demo:data              -> ./demo-data
 *   npm run demo:data -- <dir>     -> somewhere else
 *
 * then `npm run demo:shots` (make-screenshots.ts) serves it and captures pages.
 *
 * Why this exists: a screenshot of this dashboard is otherwise a screenshot of
 * somebody's real usage -- how much they downloaded, on which networks, from
 * which devices. None of that belongs in a public README. This produces a
 * history that looks like real use and contains nothing real: an invented PC
 * ("My PC"), an invented phone, invented network names, made-up volumes.
 *
 * It is not a mock. The Windows side is written as SrumECmd CSVs and loaded by
 * the real `scripts/ingest.ts`, one simulated collector run at a time; the
 * phone side goes through the real `validatePayload` and `ingestAndroid`. So
 * the numbers on the page are computed by the same code as yours, and the
 * generator has to reproduce the traps that code exists to handle
 * (docs/DESIGN.md), or the demo would be a picture of a codebase that does not
 * exist:
 *
 *   - AppId 1 aggregate rows equal to the sum of the apps in their hour, plus
 *     a sliver of unattributed traffic. Summing every row would double it.
 *   - Identities of all three kinds: NT paths, AppX package names carrying a
 *     version, and service names.
 *   - One app across two versioned install paths (Google Drive) and one AppX
 *     package across two versions (Teams), each of which must show as one app.
 *   - DoSvc, BITS and wuauserv, which Windows presents as one "System and
 *     Windows Update".
 *   - Off-cadence flush rows at sleep, which the dedup key must keep.
 *   - Collector runs whose windows overlap, so repeats must be skipped.
 *   - Network names learned by observation, one alias, one profile unnamed.
 *   - Phone tethering (uid -5) that is the laptop's hotspot traffic, counted a
 *     second time on the phone.
 *
 * The one direct write is the phone's per-network (SSID) rows. Their real
 * source is `npm run android:ssid`, which reads a phone over USB; the rows are
 * written here with that script's own upsert.
 *
 * Deterministic for a given day: a fixed seed, anchored to today so the pages
 * read as current.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { SRUM_COLUMNS } from '../src/lib/srum.js';
import {
  ingestAndroid, localParts, logAndroidSync, validatePayload,
  type AndroidApp, type AndroidBucket, type AndroidPayload,
} from '../src/lib/android-ingest.js';

/* ----------------------------------------------------------------- setup -- */

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = resolve(process.argv[2] ?? join(ROOT, 'demo-data'));
const MARKER = '.data-usage-demo';
const DB = join(OUT, 'data-usage.db');
const BACKUP = join(OUT, 'backup', 'data-usage.db');

/**
 * The same test as db.ts's guard, so the bypass is passed only when it is
 * needed. The guard exists to keep a REAL history off the drive a reset wipes;
 * this history is synthetic and regenerated at will, which is the one case the
 * guard has no reason to refuse -- the self-test's throwaway database is the
 * other.
 */
const ON_SYSTEM_DRIVE = OUT.toUpperCase().startsWith(
  (process.env['SystemDrive'] ?? 'C:').toUpperCase() + '\\',
);

/** Refuses to clear anything it did not create. */
function prepareOutDir(): void {
  if (existsSync(OUT)) {
    const entries = readdirSync(OUT);
    if (entries.length > 0 && !entries.includes(MARKER)) {
      throw new Error(
        `${OUT} is not empty and was not made by this script (no ${MARKER}). ` +
          'Refusing to clear it -- pass an empty or new directory.',
      );
    }
    rmSync(OUT, { recursive: true, force: true });
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, MARKER), 'Synthetic demo data from scripts/make-demo-data.ts. Safe to delete.\n');
}

/* ------------------------------------------------------------------ random -- */

/** mulberry32. `Math.random()` would make every run a different dashboard. */
let seed = 20260922;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const chance = (p: number) => rand() < p;
/** A day's volume around its mean: usually close, sometimes well off it. */
const spread = () => Math.exp((rand() - 0.5) * 1.2);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

/* -------------------------------------------------------------------- time -- */

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const HISTORY_DAYS = 100;
const NOW = Date.now();
const today = new Date(NOW);
/** Local midnight of history day i: 0 is the oldest, HISTORY_DAYS - 1 is today. */
const dayStart = (i: number) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() - (HISTORY_DAYS - 1 - i));
/** SRUM lags: its newest hour is routinely an hour or more old. */
const DATA_UNTIL = NOW - 2 * HOUR;

const iso = (ms: number) => new Date(ms).toISOString();
/** SrumECmd's timestamp format, in UTC. */
const srumTime = (ms: number) => iso(ms).replace('T', ' ').slice(0, 19);
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ---------------------------------------------------------------- networks -- */

// WLAN profile ids are handed out in sequence from 0x10000001 on every
// machine, so these are what a real one would carry.
const HOME = '268435457';
const CAFE = '268435459';
const HOTSPOT = '268435461';
const HOME_SSID = 'HomeNet-5G';
/** The 2.4 GHz band: a second WLAN profile that SRUM files under the same id. */
const HOME_ALIAS = 'HomeNet';
const CAFE_SSID = 'Corner Café Guest';
/** (71 << 48) | 1: IF_TYPE_IEEE80211, interface index 1. */
const WIFI_LUID = '19984723346456577';

/* -------------------------------------------------------------------- plan -- */

interface DayPlan {
  weekend: boolean;
  /** Local hour -> the network the laptop was on. Absent: off or asleep. */
  hours: Map<number, string>;
  torrentBytes: number;
  patchDay: boolean;
}

/** A weekend away, and one day the laptop stayed shut. Quiet days draw as 0. */
const OFF_DAYS = new Set([23, 24, 61]);

function planDay(i: number): DayPlan {
  const start = dayStart(i);
  const dow = start.getDay();
  const weekend = dow === 0 || dow === 6;
  const plan: DayPlan = {
    weekend,
    hours: new Map(),
    torrentBytes: 0,
    // The second Tuesday of the month.
    patchDay: dow === 2 && start.getDate() >= 8 && start.getDate() <= 14,
  };
  if (OFF_DAYS.has(i)) return plan;

  const first = weekend ? 10 : 8;
  for (let h = first; h <= 23; h++) if (!chance(0.07)) plan.hours.set(h, HOME);
  if (!weekend && chance(0.22)) for (let h = 10; h <= 14; h++) plan.hours.set(h, CAFE);
  // On the phone's hotspot on the way home; the phone counts this again.
  if (!weekend && chance(0.1)) for (const h of [17, 18]) plan.hours.set(h, HOTSPOT);
  if (chance(0.3)) {
    plan.torrentBytes = between(4, 24) * GB;
    // Left on overnight to finish it.
    for (let h = 0; h <= 5; h++) plan.hours.set(h, HOME);
  }
  return plan;
}

/* -------------------------------------------------------------- windows apps -- */

/** A path the way SRUM records it: NT namespace, lower case. */
const nt = (...parts: string[]) => ['', 'device', 'harddiskvolume3', ...parts].join('\\');
const USER = ['users', 'you'];

type Use = (day: number, plan: DayPlan) => number;
const usual = (perDay: number, weekday: number, weekend: number): Use => (_day, plan) =>
  chance(plan.weekend ? weekend : weekday) ? perDay * spread() : 0;

interface AppSpec {
  appId: number;
  identity: string;
  /** Runs as SYSTEM: services and updaters. */
  system?: boolean;
  use: Use;
  /** Local hours it favours; the other hours it is awake get a trickle. */
  peak: number[];
  upShare: number;
  only?: string[];
  /** History days it existed on, for the versioned installs. */
  from?: number;
  to?: number;
}

const APPS: AppSpec[] = [
  // Edge, with two members -- WebView2 and the updater -- so the detail page's
  // "Merged apps" card has something to show.
  {
    appId: 2001, identity: nt('program files (x86)', 'microsoft', 'edge', 'application', 'msedge.exe'),
    use: usual(1.3 * GB, 0.97, 0.9), peak: [...range(9, 12), ...range(20, 23)], upShare: 0.06,
  },
  {
    appId: 2002,
    identity: nt('program files (x86)', 'microsoft', 'edgewebview', 'application', '128.0.2739.79', 'msedgewebview2.exe'),
    use: usual(90 * MB, 0.9, 0.7), peak: range(9, 18), upShare: 0.1,
  },
  {
    appId: 2003, identity: nt('program files (x86)', 'microsoft', 'edgeupdate', 'microsoftedgeupdate.exe'),
    system: true, use: usual(140 * MB, 0.12, 0.12), peak: [11], upShare: 0.01,
  },
  {
    appId: 2010, identity: nt('program files', 'google', 'chrome', 'application', 'chrome.exe'),
    use: usual(420 * MB, 0.55, 0.4), peak: range(13, 17), upShare: 0.05,
  },
  {
    appId: 2020, identity: nt('program files', 'qbittorrent', 'qbittorrent.exe'),
    use: (_d, plan) => plan.torrentBytes, peak: [...range(0, 5), ...range(19, 23)], upShare: 0.18,
    only: [HOME],
  },
  // Google Drive before and after an update: two install paths, one app.
  {
    appId: 2030, identity: nt('program files', 'google', 'drive file stream', '128.0.0.0', 'googledrivefs.exe'),
    use: usual(520 * MB, 0.9, 0.6), peak: range(9, 22), upShare: 0.45, to: 54,
  },
  {
    appId: 2031, identity: nt('program files', 'google', 'drive file stream', '129.0.1.0', 'googledrivefs.exe'),
    use: usual(520 * MB, 0.9, 0.6), peak: range(9, 22), upShare: 0.45, from: 55,
  },
  {
    appId: 2040, identity: nt(...USER, 'appdata', 'local', 'programs', 'microsoft vs code', 'code.exe'),
    use: usual(160 * MB, 0.85, 0.3), peak: range(10, 18), upShare: 0.12,
  },
  {
    appId: 2041, identity: nt('program files', 'nodejs', 'node.exe'),
    use: usual(300 * MB, 0.7, 0.2), peak: range(10, 18), upShare: 0.08,
  },
  {
    appId: 2042, identity: nt('program files', 'git', 'mingw64', 'libexec', 'git-core', 'git-remote-https.exe'),
    use: usual(35 * MB, 0.75, 0.2), peak: range(10, 18), upShare: 0.3,
  },
  // Teams is an AppX package, and its full name changes with every update.
  {
    appId: 2050, identity: 'MSTeams_25198.1112.3855.2250_x64__8wekyb3d8bbwe',
    use: usual(650 * MB, 0.8, 0.05), peak: [10, 11, 14, 15], upShare: 0.35, to: 69,
  },
  {
    appId: 2051, identity: 'MSTeams_25212.2204.3739.1001_x64__8wekyb3d8bbwe',
    use: usual(650 * MB, 0.8, 0.05), peak: [10, 11, 14, 15], upShare: 0.35, from: 70,
  },
  {
    appId: 2052, identity: nt(...USER, 'appdata', 'roaming', 'zoom', 'bin', 'zoom.exe'),
    use: usual(480 * MB, 0.2, 0.05), peak: [16, 17], upShare: 0.4,
  },
  {
    appId: 2053, identity: nt(...USER, 'appdata', 'local', 'discord', 'app-1.0.9163', 'discord.exe'),
    use: usual(260 * MB, 0.5, 0.8), peak: range(20, 23), upShare: 0.2,
  },
  {
    appId: 2054, identity: nt(...USER, 'appdata', 'roaming', 'telegram desktop', 'telegram.exe'),
    use: usual(70 * MB, 0.85, 0.85), peak: [12, 13, ...range(19, 22)], upShare: 0.25,
  },
  {
    appId: 2060, identity: 'Microsoft.WindowsStore_22508.1401.3.0_x64__8wekyb3d8bbwe',
    use: usual(350 * MB, 0.15, 0.2), peak: [12, 13], upShare: 0.01,
  },
  // Windows presents these three as one "System and Windows Update".
  {
    appId: 2070, identity: 'DoSvc', system: true,
    use: (_d, plan) => (plan.patchDay ? between(1.8, 2.6) * GB : chance(0.15) ? 150 * MB * spread() : 0),
    peak: [11, 12, 13], upShare: 0.08,
  },
  {
    appId: 2071, identity: 'BITS', system: true,
    use: (_d, plan) => (plan.patchDay ? between(300, 500) * MB : chance(0.2) ? 40 * MB * spread() : 0),
    peak: [11, 12, 13], upShare: 0.01,
  },
  {
    appId: 2072, identity: 'wuauserv', system: true,
    use: usual(6 * MB, 0.9, 0.9), peak: [11], upShare: 0.1,
  },
  // Tiny but daily: the persistence route to a detail page.
  {
    appId: 2073, identity: 'CryptSvc', system: true,
    use: usual(1.2 * MB, 1, 1), peak: range(8, 22), upShare: 0.2,
  },
  {
    appId: 2074, identity: 'Dnscache', system: true,
    use: usual(2 * MB, 1, 1), peak: range(8, 22), upShare: 0.4,
  },
  // A one-off installer: 118 MB on one day earns no detail page.
  {
    appId: 2080, identity: nt(...USER, 'downloads', 'vs_setup_bootstrapper.exe'),
    use: (day) => (day === 33 ? 118 * MB : 0), peak: [15], upShare: 0.01,
  },
];

/* ------------------------------------------------------------- windows rows -- */

interface SrumRow {
  t: number;
  appId: number;
  identity: string;
  system: boolean;
  profile: string;
  rx: number;
  tx: number;
}

interface HourSlot {
  t: number;
  day: number;
  profile: string;
  rows: SrumRow[];
}

/** SRUM flushes once an hour at a minute or two past; every app shares it. */
function flushTime(day: number, hour: number): number {
  const d = dayStart(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 1 + ((day * 7 + hour) % 5), (day * 13 + hour * 7) % 60).getTime();
}

function aggregateOf(slot: { t: number; profile: string; rows: SrumRow[] }): SrumRow {
  const rx = slot.rows.reduce((s, r) => s + r.rx, 0);
  const tx = slot.rows.reduce((s, r) => s + r.tx, 0);
  // A sliver more than the apps: traffic from processes that exited before
  // SRUM could attribute it. Measured at about 0.1% on a real machine.
  return {
    t: slot.t, appId: 1, identity: '', system: false, profile: slot.profile,
    rx: Math.round(rx * (1 + between(0, 0.0025))), tx: Math.round(tx * (1 + between(0, 0.0025))),
  };
}

function buildWindows(plans: DayPlan[]): { rows: SrumRow[]; slots: HourSlot[] } {
  const slots = new Map<string, HourSlot>();
  const slotFor = (day: number, hour: number, profile: string): HourSlot => {
    const key = `${day}:${hour}`;
    let s = slots.get(key);
    if (!s) slots.set(key, (s = { t: flushTime(day, hour), day, profile, rows: [] }));
    return s;
  };

  for (let day = 0; day < HISTORY_DAYS; day++) {
    const plan = plans[day]!;
    for (const app of APPS) {
      if ((app.from !== undefined && day < app.from) || (app.to !== undefined && day > app.to)) continue;
      const dayBytes = app.use(day, plan);
      if (dayBytes <= 0) continue;
      const hours = [...plan.hours.entries()].filter(([, p]) => !app.only || app.only.includes(p));
      if (hours.length === 0) continue;
      const weights = hours.map(([h]) => (app.peak.includes(h) ? 3 : 0.35) * between(0.6, 1.4));
      const total = weights.reduce((a, b) => a + b, 0);
      hours.forEach(([hour, profile], k) => {
        const bytes = (dayBytes * weights[k]!) / total;
        if (bytes < 20 * 1024) return;
        const up = Math.min(0.9, app.upShare * between(0.7, 1.3));
        const slot = slotFor(day, hour, profile);
        slot.rows.push({
          t: slot.t, appId: app.appId, identity: app.identity, system: !!app.system, profile,
          rx: Math.round(bytes * (1 - up)), tx: Math.round(bytes * up),
        });
      });
    }
  }

  const rows: SrumRow[] = [];
  const kept: HourSlot[] = [];
  for (const slot of slots.values()) {
    if (slot.rows.length === 0 || slot.t >= DATA_UNTIL) continue;
    kept.push(slot);
    rows.push(...slot.rows, aggregateOf(slot));
  }

  // Off-cadence rows: SRUM flushes again when the machine sleeps, at whatever
  // minute that happens, and the dedup key must keep them beside the hourly
  // row of the same app and hour.
  for (let day = 0; day < HISTORY_DAYS; day++) {
    const last = Math.max(...plans[day]!.hours.keys(), -1);
    if (last < 20 || !chance(0.12)) continue;
    const d = dayStart(day);
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), last, 40, 12).getTime();
    if (t >= DATA_UNTIL) continue;
    const profile = plans[day]!.hours.get(last)!;
    const flush = { t, profile, rows: [] as SrumRow[] };
    for (const app of [APPS[0]!, APPS[14]!]) {
      const bytes = between(2, 30) * MB;
      flush.rows.push({
        t, appId: app.appId, identity: app.identity, system: false, profile,
        rx: Math.round(bytes * 0.93), tx: Math.round(bytes * 0.07),
      });
    }
    rows.push(...flush.rows, aggregateOf(flush));
  }

  rows.sort((a, b) => a.t - b.t || a.appId - b.appId);
  kept.sort((a, b) => a.t - b.t);
  return { rows, slots: kept };
}

/** One CSV exactly as SrumECmd writes it: BOM, header in file order, CRLF. */
function srumCsv(rows: SrumRow[]): string {
  const columns = Object.values(SRUM_COLUMNS);
  const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [columns.join(',')];
  rows.forEach((r, i) => {
    const aggregate = r.appId === 1;
    const record: Record<string, string> = {
      [SRUM_COLUMNS.id]: String(i + 1),
      [SRUM_COLUMNS.timestamp]: srumTime(r.t),
      [SRUM_COLUMNS.exeInfo]: r.identity,
      [SRUM_COLUMNS.exeInfoDescription]: '',
      [SRUM_COLUMNS.exeTimestamp]: '',
      [SRUM_COLUMNS.sidType]: aggregate ? '' : r.system ? 'LocalSystem' : 'UnknownOrUserSid',
      // A placeholder account SID, obviously not anyone's.
      [SRUM_COLUMNS.sid]: aggregate ? '' : r.system ? 'S-1-5-18' : 'S-1-5-21-1000000000-2000000000-3000000000-1001',
      [SRUM_COLUMNS.userName]: '',
      [SRUM_COLUMNS.userId]: aggregate ? '' : r.system ? '3' : '401',
      [SRUM_COLUMNS.appId]: String(r.appId),
      [SRUM_COLUMNS.bytesReceived]: String(r.rx),
      [SRUM_COLUMNS.bytesSent]: String(r.tx),
      [SRUM_COLUMNS.interfaceLuid]: WIFI_LUID,
      [SRUM_COLUMNS.interfaceType]: 'IF_TYPE_IEEE80211',
      [SRUM_COLUMNS.l2ProfileFlags]: '0',
      [SRUM_COLUMNS.l2ProfileId]: r.profile,
      // Empty in every real row too: SRUM never fills it (docs/DESIGN.md).
      [SRUM_COLUMNS.profileName]: '',
    };
    lines.push(columns.map((c) => quote(record[c] ?? '')).join(','));
  });
  return String.fromCharCode(0xfeff) + lines.join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------ collector runs -- */

interface Run {
  at: number;
  failed?: string;
  /** Which network the machine was on when this run wrote network.json. */
  observe?: string;
}

function schedule(): Run[] {
  const runs: Run[] = [];
  // Weekly here to keep generation quick; the real task is daily. Windows
  // overlap either way, since SRUM holds far more than a week.
  for (let d = 40, k = 0; d < HISTORY_DAYS - 1; d += 7, k++) {
    const observe = k === 2 || k === 6 ? CAFE_SSID : k === 4 ? HOME_ALIAS : HOME_SSID;
    runs.push({ at: dayStart(d).getTime() + 3.5 * HOUR, observe });
  }
  // One failure, recorded the way the collector records one.
  runs.push({
    at: dayStart(72).getTime() + 3.5 * HOUR,
    failed: 'SrumECmd produced no NetworkUsage CSV (the snapshot was still in Dirty Shutdown)',
  });
  runs.push({ at: NOW - 50 * MINUTE, observe: HOME_SSID });
  return runs.sort((a, b) => a.at - b.at);
}

function ingestArgs(extra: string[]): string[] {
  return [
    '--import', 'tsx', join(ROOT, 'scripts', 'ingest.ts'),
    '--db', DB, '--backup-to', BACKUP,
    ...(ON_SYSTEM_DRIVE ? ['--allow-system-drive'] : []),
    ...extra,
  ];
}

/** Runs happen now; the history needs them spread over the last 100 days. */
function backdateLastRun(at: number, durationMs: number): void {
  const db = new DatabaseSync(DB);
  try {
    db.prepare(
      `UPDATE sync_log SET started_at = ?, finished_at = ?, duration_ms = ?
       WHERE id = (SELECT MAX(id) FROM sync_log)`,
    ).run(iso(at), iso(at + durationMs), durationMs);
  } finally {
    db.close();
  }
}

function runCollector(runs: Run[], rows: SrumRow[], slots: HourSlot[]): void {
  const runsDir = join(OUT, 'runs');
  runs.forEach((run, n) => {
    const label = new Date(run.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    if (run.failed) {
      execFileSync(process.execPath, ingestArgs(['--record-failure', run.failed]), { cwd: ROOT, stdio: 'pipe' });
      backdateLastRun(run.at, Math.round(between(8, 14) * 1000));
      console.log(`  run ${String(n + 1).padStart(2)}  ${label}  failed (recorded)`);
      return;
    }

    // What SRUM would hold at that moment: about 60 days back, lagging an hour.
    const window = rows.filter((r) => r.t >= run.at - 60 * DAY && r.t < run.at - HOUR);
    const dir = join(runsDir, String(n + 1).padStart(2, '0'));
    const csvDir = join(dir, 'csv');
    mkdirSync(csvDir, { recursive: true });
    writeFileSync(join(csvDir, 'SrumECmd_NetworkUsages_Output.csv'), srumCsv(window));

    // network.json, as the collector writes it. Its time falls inside an hour
    // the window holds and only one profile used, so it resolves at once.
    const wanted = run.observe === CAFE_SSID ? CAFE : HOME;
    const hour = [...slots].reverse().find(
      (s) => s.profile === wanted && s.t >= run.at - 60 * DAY && s.t < run.at - HOUR,
    );
    if (run.observe && hour) {
      writeFileSync(join(dir, 'network.json'), JSON.stringify({
        observedAt: iso(hour.t + 5 * MINUTE),
        connections: [{ name: run.observe, interface: 'Wi-Fi' }],
      }));
    }

    const out = execFileSync(process.execPath, ingestArgs(['--csv', csvDir]), { cwd: ROOT, encoding: 'utf8' });
    const inserted = /inserted:\s*(\d+)/.exec(out)?.[1] ?? '?';
    const skipped = /skipped\s*:\s*(\d+)/.exec(out)?.[1] ?? '?';
    backdateLastRun(run.at, Math.round(between(19, 31) * 1000));
    console.log(`  run ${String(n + 1).padStart(2)}  ${label}  ${window.length} rows read, ${inserted} inserted, ${skipped} already present`);
  });
}

/* ------------------------------------------------------------------- phone -- */

const PHONE = {
  deviceId: 'demo-phone-7f3a9c21',
  label: 'Pixel 8',
  brand: 'Google',
  model: 'Pixel 8',
  release: '15',
  sdk: 35,
};
const PHONE_DAYS = 90;
const BUCKET = 2 * HOUR;
const OFFSET = -today.getTimezoneOffset();

interface PhoneApp extends AndroidApp {
  perDay: number;
  chance: number;
  peak: number[];
  upShare: number;
  wifiOnly?: boolean;
  mobileOnly?: boolean;
}

const PHONE_APPS: PhoneApp[] = [
  { uid: 10151, package: 'com.google.android.youtube', label: 'YouTube', isSystem: false, perDay: 420 * MB, chance: 0.9, peak: range(19, 23), upShare: 0.03 },
  { uid: 10233, package: 'com.netflix.mediaclient', label: 'Netflix', isSystem: false, perDay: 1.1 * GB, chance: 0.18, peak: range(20, 23), upShare: 0.01, wifiOnly: true },
  { uid: 10198, package: 'com.spotify.music', label: 'Spotify', isSystem: false, perDay: 70 * MB, chance: 0.8, peak: [8, 9, 17, 18], upShare: 0.03 },
  { uid: 10205, package: 'com.instagram.android', label: 'Instagram', isSystem: false, perDay: 260 * MB, chance: 0.85, peak: [12, 13, 21, 22], upShare: 0.08 },
  { uid: 10167, package: 'com.android.chrome', label: 'Chrome', isSystem: false, perDay: 110 * MB, chance: 0.9, peak: range(9, 22), upShare: 0.06 },
  { uid: 10212, package: 'com.whatsapp', label: 'WhatsApp', isSystem: false, perDay: 60 * MB, chance: 0.98, peak: range(9, 22), upShare: 0.35 },
  { uid: 10177, package: 'com.google.android.apps.maps', label: 'Maps', isSystem: false, perDay: 25 * MB, chance: 0.4, peak: [8, 9, 17, 18], upShare: 0.1, mobileOnly: true },
  { uid: 10120, package: 'com.google.android.gms', label: 'Google Play services', isSystem: true, perDay: 45 * MB, chance: 1, peak: range(0, 23), upShare: 0.2 },
  { uid: 10131, package: 'com.android.vending', label: 'Google Play Store', isSystem: true, perDay: 380 * MB, chance: 0.3, peak: range(1, 5), upShare: 0.01, wifiOnly: true },
  { uid: 1000, package: 'android', label: 'Android System', isSystem: true, perDay: 8 * MB, chance: 1, peak: range(0, 23), upShare: 0.3 },
];
/** uid 1000 is shared by many system packages; the page says how many. */
const SHARED_UID_EXTRA: AndroidApp = { uid: 1000, package: 'com.android.settings', label: 'Settings', isSystem: true };

type Place = 'home' | 'cafe' | 'out';

function placeOf(plan: DayPlan | undefined, day: number, hour: number): Place {
  if (!plan || OFF_DAYS.has(day)) return 'out';
  if (plan.hours.get(hour) === CAFE) return 'cafe';
  if (plan.weekend || hour < 8 || hour >= 19) return 'home';
  return 'out';
}

interface PhoneBucket extends AndroidBucket {
  place: Place;
}

function buildPhone(plans: DayPlan[], slots: HourSlot[]): PhoneBucket[] {
  const dayIndex = new Map<string, number>();
  for (let i = 0; i < HISTORY_DAYS; i++) dayIndex.set(localDate(dayStart(i)), i);

  const first = Math.ceil(dayStart(HISTORY_DAYS - PHONE_DAYS).getTime() / BUCKET) * BUCKET;
  const starts: number[] = [];
  for (let t = first; t + BUCKET <= NOW - HOUR; t += BUCKET) starts.push(t);

  const buckets = new Map<string, PhoneBucket>();
  const add = (uid: number, start: number, place: Place, rx: number, tx: number) => {
    const network = place === 'out' ? 'mobile' : 'wifi';
    const key = `${uid}|${start}|${network}`;
    const b = buckets.get(key) ?? {
      uid, start, network, metered: network === 'mobile', roaming: false, rx: 0, tx: 0, place,
    };
    b.rx += Math.round(rx);
    b.tx += Math.round(tx);
    buckets.set(key, b);
  };

  // Group the buckets by the phone's local day, then spread each app's day.
  const byDay = new Map<string, number[]>();
  for (const s of starts) {
    const { date } = localParts(s, OFFSET);
    byDay.set(date, [...(byDay.get(date) ?? []), s]);
  }
  for (const [date, dayStarts] of byDay) {
    const day = dayIndex.get(date) ?? -1;
    const plan = plans[day];
    for (const app of PHONE_APPS) {
      if (!chance(app.chance)) continue;
      const dayBytes = app.perDay * spread();
      const slotsOfDay = dayStarts.map((s) => {
        const hour = localParts(s, OFFSET).hour;
        const place = placeOf(plan, day, hour);
        const asleep = hour < 7 && !app.isSystem;
        let w = (app.peak.includes(hour) || app.peak.includes(hour + 1) ? 3 : 0.3) * between(0.6, 1.4);
        if (asleep) w *= 0.05;
        if (app.wifiOnly && place === 'out') w = 0;
        if (app.mobileOnly && place !== 'out') w *= 0.2;
        return { s, place, w };
      });
      const total = slotsOfDay.reduce((a, x) => a + x.w, 0);
      if (total === 0) continue;
      for (const { s, place, w } of slotsOfDay) {
        const bytes = (dayBytes * w) / total;
        if (bytes < 8 * 1024) continue;
        const up = Math.min(0.9, app.upShare * between(0.7, 1.3));
        add(app.uid, s, place, bytes * (1 - up), bytes * up);
      }
    }
  }

  // Tethering: the laptop's hotspot hours, relayed by the phone over mobile
  // data. The same bytes are already in the laptop's history, which is the
  // double count the dashboard keeps apart.
  for (const slot of slots) {
    if (slot.profile !== HOTSPOT) continue;
    const agg = aggregateOf(slot);
    const start = Math.floor(slot.t / BUCKET) * BUCKET;
    if (start < first) continue;
    add(-5, start, 'out', agg.rx * 1.02, agg.tx * 1.02);
  }

  return [...buckets.values()].filter((b) => b.rx + b.tx > 0).sort((a, b) => a.start - b.start);
}

/** The app syncs every few hours; weekly here, re-reading one bucket each time. */
function uploadPhone(buckets: PhoneBucket[]): void {
  const opts = { dbPath: DB, allowSystemDrive: ON_SYSTEM_DRIVE };
  const apps: AndroidApp[] = [
    ...PHONE_APPS.map(({ uid, package: pkg, label, isSystem }) => ({ uid, package: pkg, label, isSystem })),
    SHARED_UID_EXTRA,
  ];
  const first = buckets[0]!.start;
  const uploads: number[] = [];
  for (let t = first + DAY + 6 * HOUR; t < NOW - DAY; t += 7 * DAY) uploads.push(t);
  uploads.push(NOW - 40 * MINUTE);

  let watermark = -Infinity;
  for (const at of uploads) {
    const batch = buckets.filter((b) => b.start >= watermark && b.start + BUCKET <= at);
    if (batch.length === 0) continue;
    const version = at < NOW - 30 * DAY ? '1.0' : at < NOW - 10 * DAY ? '1.1' : '1.2';
    const payload: AndroidPayload = {
      ...PHONE,
      appVersion: version,
      utcOffsetMinutes: OFFSET,
      apps,
      buckets: batch.map(({ place: _place, ...b }) => b),
    };
    const outcome = ingestAndroid(validatePayload(payload), opts);
    logAndroidSync(PHONE.deviceId, 'success', {
      bucketsSent: batch.length, rowsWritten: outcome.written, rowsUpdated: outcome.updated,
      appsSent: apps.length, oldest: outcome.oldest, newest: outcome.newest, appVersion: version,
    }, opts);
    const db = new DatabaseSync(DB);
    db.prepare(`UPDATE android_sync_log SET received_at = ? WHERE id = (SELECT MAX(id) FROM android_sync_log)`)
      .run(iso(at));
    db.close();
    // The next read starts one bucket before the newest the server confirmed.
    watermark = Math.max(...batch.map((b) => b.start));
  }
  console.log(`  phone     ${uploads.length} uploads, ${buckets.length} buckets`);
}

/**
 * Per-network rows, as `npm run android:ssid` would have captured them three
 * days ago over USB. Mobile carries no SSID; a few percent of the Wi-Fi is
 * left unlabelled, which the page reports as traffic that crossed a VPN.
 */
function captureSsids(buckets: PhoneBucket[]): void {
  const capturedAt = NOW - 3 * DAY;
  const db = new DatabaseSync(DB);
  const upsert = db.prepare(`
    INSERT INTO android_ssid_usage
      (device_id, uid, bucket_start_utc, local_date, local_hour, ssid, metered,
       rx_bytes, tx_bytes, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id, uid, bucket_start_utc, ssid, metered) DO UPDATE SET
      rx_bytes    = MAX(rx_bytes, excluded.rx_bytes),
      tx_bytes    = MAX(tx_bytes, excluded.tx_bytes),
      ingested_at = excluded.ingested_at
    WHERE excluded.rx_bytes > rx_bytes OR excluded.tx_bytes > tx_bytes
  `);
  let n = 0;
  db.exec('BEGIN');
  for (const b of buckets) {
    if (b.network !== 'wifi' || b.start + BUCKET > capturedAt) continue;
    const { date, hour } = localParts(b.start, OFFSET);
    upsert.run(
      PHONE.deviceId, b.uid, iso(b.start), date, hour,
      b.place === 'cafe' ? CAFE_SSID : HOME_SSID, 0,
      Math.round(b.rx * 0.96), Math.round(b.tx * 0.96), iso(capturedAt),
    );
    n++;
  }
  db.prepare(
    `INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(`android_ssid_last_collect:${PHONE.deviceId}`, iso(capturedAt));
  db.exec('COMMIT');
  db.close();
  console.log(`  ssid      ${n} rows, captured ${new Date(capturedAt).toLocaleDateString('en-GB')}`);
}

/* -------------------------------------------------------------------- main -- */

function main(): void {
  prepareOutDir();
  console.log(`demo data -> ${OUT}`);

  const plans = Array.from({ length: HISTORY_DAYS }, (_, i) => planDay(i));
  const { rows, slots } = buildWindows(plans);
  runCollector(schedule(), rows, slots);

  const phone = buildPhone(plans, slots);
  uploadPhone(phone);
  captureSsids(phone);

  // The dashboard reads only these three keys. DATA_USAGE_CONFIG points it here.
  writeFileSync(join(OUT, 'collector.json'), JSON.stringify({
    _note: 'Synthetic demo data from scripts/make-demo-data.ts. Not anyone\'s usage.',
    databasePath: DB,
    deviceLabel: 'My PC',
    splitApp: 'qBittorrent',
  }, null, 2) + '\n');

  // The aggregate trap, checked on the result: totals and per-app sums agree
  // to a fraction of a percent, and adding them together would double it.
  const db = new DatabaseSync(DB, { readOnly: true });
  const sum = (where: string) => Number((db.prepare(
    `SELECT SUM(bytes_sent + bytes_received) b FROM usage_records WHERE ${where}`,
  ).get() as { b: number }).b);
  const aggregate = sum('is_aggregate = 1');
  const apps = sum('is_aggregate = 0');
  const names = db.prepare('SELECT name, votes FROM network_names ORDER BY votes DESC').all() as { name: string; votes: number }[];
  db.close();
  console.log(`  windows   ${(aggregate / GB).toFixed(1)} GB total, apps ${(apps / GB).toFixed(1)} GB ` +
    `(${(((aggregate - apps) / aggregate) * 100).toFixed(2)}% unattributed)`);
  console.log(`  networks  ${names.map((n) => `${n.name} x${n.votes}`).join(', ')}`);
  console.log(`\nconfig    ${join(OUT, 'collector.json')}`);
}

main();
