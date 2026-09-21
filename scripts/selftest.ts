/**
 * Self-test for the ingest pipeline.
 *
 *   npx tsx scripts/selftest.ts
 *
 * Runs against a synthetic CSV in a temp directory -- no admin, no VSS, no real
 * SRUM data. It exists because the interesting failure modes here are silent
 * ones: a dedup key that drops real traffic, an idempotency bug that duplicates
 * rows on every scheduled run, or a timezone slip that files traffic under the
 * wrong day. None of those announce themselves in normal use.
 *
 * The fixture reproduces every awkward case found in the real data on
 * 2026-08-20.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { resolveApp } from '../src/lib/app-name.js';
import { classifyApp, parseSrumTimestamp, toLocalBuckets } from '../src/lib/srum.js';
import {
  ingestAndroid, validatePayload, localParts, type AndroidPayload,
} from '../src/lib/android-ingest.js';
import {
  coveredDays, daySpanLabel, eachDay, fillDays, isKnown,
} from '../src/lib/days.js';
import { safeNextPath } from '../src/lib/safe-redirect.js';
import { isSameOrigin } from '../src/lib/same-origin.js';
import { parseDays, ALL_DAYS, DEFAULT_DAYS } from '../src/lib/scope.js';
import { LoginThrottle, DEFAULT_THROTTLE } from '../src/lib/login-throttle.js';
import {
  issueSession, verifySession, passwordStatus, MIN_PASSWORD_LENGTH,
} from '../src/lib/auth.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
    failures++;
  }
}

const HEADER =
  'Id,Timestamp,ExeInfo,ExeInfoDescription,ExeTimestamp,SidType,Sid,UserName,' +
  'UserId,AppId,BytesReceived,BytesSent,InterfaceLuid,InterfaceType,' +
  'L2ProfileFlags,L2ProfileId,ProfileName';

const LUID = '19985273102270464'; // exceeds 2^53 -- must survive as TEXT
const IF = 'IF_TYPE_IEEE80211';

function row(o: {
  id: number; ts: string; exe: string; appId: number;
  recv: number; sent: number; luid?: string; l2?: string; userId?: string;
}): string {
  return [
    o.id, o.ts, o.exe, '', '', '1', 'S-1-5-21-x', 'user1',
    o.userId ?? '1001', o.appId, o.recv, o.sent, o.luid ?? LUID, IF,
    '0', o.l2 ?? '268435457', '',
  ].join(',');
}

const FIXTURE = [
  HEADER,
  // Aggregate rows: bytes equal the sum of the named apps in the same hour.
  row({ id: 1, ts: '2026-08-19 10:00:00', exe: '', appId: 1, recv: 3000, sent: 300 }),
  row({ id: 2, ts: '2026-08-19 11:00:00', exe: '', appId: 1, recv: 5000, sent: 500 }),

  // Named apps for hour 10: 1000+2000 recv, 100+200 sent = the aggregate above.
  row({ id: 3, ts: '2026-08-19 10:00:00', exe: '\\device\\harddiskvolume4\\program files\\qbittorrent\\qbittorrent.exe', appId: 10, recv: 2000, sent: 200 }),
  row({ id: 4, ts: '2026-08-19 10:00:00', exe: 'DoSvc', appId: 11, recv: 1000, sent: 100 }),

  // Hour 11.
  row({ id: 5, ts: '2026-08-19 11:00:00', exe: 'BITS', appId: 12, recv: 5000, sent: 500 }),

  // Same app under two versioned install directories -- must group into one.
  row({ id: 6, ts: '2026-08-19 12:00:00', exe: '\\device\\harddiskvolume4\\program files\\google\\drive file stream\\129.0.1.0\\googledrivefs.exe', appId: 13, recv: 100, sent: 10 }),
  row({ id: 7, ts: '2026-08-19 12:00:00', exe: '\\device\\harddiskvolume4\\program files\\google\\drive file stream\\128.0.0.0\\googledrivefs.exe', appId: 14, recv: 200, sent: 20 }),

  // Two AppX versions of one package -- must group into one.
  row({ id: 8, ts: '2026-08-19 13:00:00', exe: 'OpenAI.Codex_26.814.5517.0_x64__2p2nqsd0c76g0', appId: 15, recv: 100, sent: 10 }),
  row({ id: 9, ts: '2026-08-19 13:00:00', exe: 'OpenAI.Codex_26.810.4967.0_x64__2p2nqsd0c76g0', appId: 16, recv: 200, sent: 20 }),

  // Same app+hour on a DIFFERENT network profile. The spec's original dedup key
  // would have collapsed this into the row above and lost the traffic.
  row({ id: 10, ts: '2026-08-19 14:00:00', exe: '\\device\\harddiskvolume4\\a.exe', appId: 20, recv: 111, sent: 11, l2: '268435477' }),
  row({ id: 11, ts: '2026-08-19 14:00:00', exe: '\\device\\harddiskvolume4\\a.exe', appId: 20, recv: 222, sent: 22, l2: '268435457' }),

  // Off-cadence sleep/shutdown rows: same timestamp, same app, same profile,
  // DIFFERENT bytes. Both are real measurements and both must survive.
  row({ id: 12, ts: '2026-08-19 18:40:00', exe: '\\device\\harddiskvolume4\\b.exe', appId: 21, recv: 5695, sent: 11810 }),
  row({ id: 13, ts: '2026-08-19 18:40:00', exe: '\\device\\harddiskvolume4\\b.exe', appId: 21, recv: 16632307, sent: 977002503 }),

  // A path containing a comma, quoted -- exercises the CSV parser.
  `14,2026-08-19 15:00:00,"\\device\\harddiskvolume4\\weird, path\\c.exe",,,1,S-1-5-21-x,user1,1001,22,50,5,${LUID},${IF},0,268435457,`,
  '',
].join('\n');

function ingest(csvDir: string, dbPath: string): string {
  return execFileSync(
    process.execPath,
    ['--import', 'tsx', join(ROOT, 'scripts', 'ingest.ts'),
     '--csv', csvDir, '--db', dbPath, '--no-backup',
     // Temp dirs live on C:. The guard is correct to refuse that in real use;
     // this is a throwaway database that is deleted at the end of the test.
     '--allow-system-drive'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

async function main(): Promise<void> {
  console.log('\n== unit ==');

  check('classify NT path', classifyApp(10, '\\device\\harddiskvolume4\\x.exe') === 'path');
  check('classify AppX', classifyApp(10, 'OpenAI.Codex_26.814.5517.0_x64__2p2nqsd0c76g0') === 'appx');
  check('classify service', classifyApp(10, 'DoSvc') === 'service');
  check('classify aggregate by id', classifyApp(1, '') === 'aggregate');

  check('versioned paths group together',
    resolveApp('\\a\\129.0.1.0\\googledrivefs.exe', 'path').groupKey ===
    resolveApp('\\a\\128.0.0.0\\googledrivefs.exe', 'path').groupKey);

  check('AppX versions group together',
    resolveApp('OpenAI.Codex_26.814.5517.0_x64__p', 'appx').groupKey ===
    resolveApp('OpenAI.Codex_26.810.4967.0_x64__p', 'appx').groupKey);

  check('DoSvc and BITS group as one',
    resolveApp('DoSvc', 'service').groupKey === resolveApp('BITS', 'service').groupKey);

  check('versioned service names group together',
    resolveApp('GoogleUpdaterService151.0.7910.0', 'service').groupKey ===
    resolveApp('GoogleUpdaterService152.0.7933.0', 'service').groupKey);

  check('service names ending in a plain digit are untouched',
    resolveApp('Tcpip6', 'service').displayName === 'Tcpip6');

  check('OpenAI.Codex AppX resolves to ChatGPT, as Windows labels it',
    resolveApp('OpenAI.Codex_26.814.5517.0_x64__2p2nqsd0c76g0', 'appx').displayName === 'ChatGPT');

  check('Claude AppX resolves to Claude',
    resolveApp('Claude_1.15962.1.0_x64__pzs8sxrjxfjjc', 'appx').displayName === 'Claude');

  // Reversed on purpose. The CLI and the desktop app used to be kept apart on
  // the grounds that they are different programs. They are -- and the family
  // still records that, which is what the memberKey check below asserts -- but
  // they are one product, so the table and the charts group them.
  check('claude.exe and Claude AppX merge into one family',
    resolveApp('\\a\\claude.exe', 'path').groupKey ===
    resolveApp('Claude_1.15962.1.0_x64__pzs8sxrjxfjjc', 'appx').groupKey);

  check('...but stay distinct members inside it',
    resolveApp('\\a\\claude.exe', 'path').memberKey !==
    resolveApp('Claude_1.15962.1.0_x64__pzs8sxrjxfjjc', 'appx').memberKey);

  check('member names survive the merge',
    resolveApp('\\a\\claude.exe', 'path').memberName === 'Claude Code' &&
    resolveApp('Claude_1.15962.1.0_x64__pzs8sxrjxfjjc', 'appx').memberName === 'Claude Desktop');

  check('codex.exe joins the ChatGPT family',
    resolveApp('\\a\\codex.exe', 'path').groupKey ===
    resolveApp('OpenAI.Codex_26.814.5517.0_x64__p', 'appx').groupKey);

  check('ollama.exe and ollama app.exe merge',
    resolveApp('\\a\\ollama.exe', 'path').groupKey ===
    resolveApp('\\a\\ollama app.exe', 'path').groupKey);

  // Windows spawns one instance of these per logon session and the hex tail
  // changes every boot; left alone they produced ~100 single-row entries.
  check('per-session service instances group together',
    resolveApp('WpnUserService_ca529', 'service').groupKey ===
    resolveApp('WpnUserService_13276d02', 'service').groupKey);

  check('AppX-shaped service names lose their package tail',
    resolveApp('windows.immersivecontrolpanel_10.0.8.1000_neutral_neutral_cw5n1h2txyewy', 'service')
      .displayName === 'Settings');

  // setup.exe names a task, not a program: two unrelated installers must not
  // merge into one row labelled "setup.exe".
  check('generic basenames are keyed by their directory',
    resolveApp('\\a\\program files (x86)\\microsoft visual studio\\installer\\setup.exe', 'path').groupKey !==
    resolveApp('\\a\\nvidia\\nvapp2\\setup.exe', 'path').groupKey);

  check('proper names are applied',
    resolveApp('\\a\\ollama.exe', 'path').displayName === 'Ollama' &&
    resolveApp('\\a\\studio64.exe', 'path').displayName === 'Android Studio' &&
    resolveApp('\\a\\java.exe', 'path').displayName === 'Java');

  // Timezone: SrumECmd emits UTC. At UTC+6, 2026-08-19T20:30Z is the 20th
  // locally, so bucketing off the raw UTC date would file it a day early.
  const utc = parseSrumTimestamp('2026-08-19 20:30:00')!;
  const b = toLocalBuckets(utc);
  const expected = new Date(Date.UTC(2026, 7, 19, 20, 30));
  const expDate = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
  check('timestamp parsed as UTC', utc.toISOString() === '2026-08-19T20:30:00.000Z');
  check('local bucket uses local timezone', b.localDate === expDate, `got ${b.localDate}`);

  console.log('\n== ingest ==');

  const dir = mkdtempSync(join(tmpdir(), 'duselftest-'));
  const csvDir = join(dir, 'csv');
  const dbPath = join(dir, 'test.db');

  try {
    execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(csvDir)},{recursive:true})`]);
    writeFileSync(join(csvDir, '20260820_SrumECmd_NetworkUsages_Output.csv'), FIXTURE, 'utf8');

    const out1 = ingest(csvDir, dbPath);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const one = <T>(sql: string): T => db.prepare(sql).get() as T;

    const total = one<{ c: number }>('SELECT COUNT(*) c FROM usage_records').c;
    check('all 14 fixture rows ingested', total === 14, `got ${total}`);

    const offCadence = one<{ c: number }>(
      `SELECT COUNT(*) c FROM usage_records WHERE app_identity LIKE '%b.exe'`).c;
    check('off-cadence rows with differing bytes both kept', offCadence === 2, `got ${offCadence}`);

    const profiles = one<{ c: number }>(
      `SELECT COUNT(*) c FROM usage_records WHERE app_identity LIKE '%a.exe'`).c;
    check('same app+hour on two profiles both kept', profiles === 2, `got ${profiles}`);

    const luid = one<{ interface_luid: string }>(
      'SELECT interface_luid FROM usage_records LIMIT 1').interface_luid;
    check('LUID survives without precision loss', luid === LUID, `got ${luid}`);

    const comma = one<{ c: number }>(
      `SELECT COUNT(*) c FROM usage_records WHERE app_identity LIKE '%weird, path%'`).c;
    check('quoted field with comma parsed', comma === 1, `got ${comma}`);

    const aggCount = one<{ c: number }>(
      'SELECT COUNT(*) c FROM usage_records WHERE is_aggregate = 1').c;
    check('aggregate rows flagged', aggCount === 2, `got ${aggCount}`);

    // The double-counting check, in miniature.
    const agg = one<{ b: number }>(
      'SELECT SUM(bytes_sent + bytes_received) b FROM usage_records WHERE is_aggregate = 1').b;
    const apps = one<{ b: number }>(
      `SELECT SUM(bytes_sent + bytes_received) b FROM usage_records
       WHERE is_aggregate = 0 AND local_hour IN (
         SELECT local_hour FROM usage_records WHERE is_aggregate = 1)`).b;
    check('aggregate equals sum of named apps in same hours', agg === apps, `${agg} vs ${apps}`);

    db.close();

    // The property the daily schedule depends on.
    const out2 = ingest(csvDir, dbPath);
    const db2 = new DatabaseSync(dbPath, { readOnly: true });
    const after = (db2.prepare('SELECT COUNT(*) c FROM usage_records').get() as { c: number }).c;
    const runs = (db2.prepare('SELECT COUNT(*) c FROM sync_log').get() as { c: number }).c;
    const lastRun = db2.prepare(
      'SELECT rows_inserted i, rows_skipped s, status FROM sync_log ORDER BY id DESC LIMIT 1',
    ).get() as { i: number; s: number; status: string };
    db2.close();

    check('re-ingest inserts zero rows', after === 14, `got ${after}`);
    check('re-ingest reports 0 inserted', lastRun.i === 0, `got ${lastRun.i}`);
    check('re-ingest reports 14 skipped', lastRun.s === 14, `got ${lastRun.s}`);
    check('both runs logged', runs === 2, `got ${runs}`);
    check('runs marked success', lastRun.status === 'success', lastRun.status);

    if (process.argv.includes('--verbose')) {
      console.log('\n--- run 1 ---\n' + out1 + '\n--- run 2 ---\n' + out2);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  androidChecks();
  dayChecks();
  await securityChecks();

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

/* ------------------------------------------------------------------ */
/* Filling daily series                                                */
/* ------------------------------------------------------------------ */

/**
 * `lib/days.ts` decides whether a day with no rows is a quiet day or an
 * unknown one, and both wrong answers are silent: a chart that bridges 84 idle
 * days looks like steady growth, and one that zero-fills a stretch nothing
 * collected invents quiet days. See the header of that file.
 */
function dayChecks(): void {
  console.log('\n== daily series ==');

  const days = eachDay('2026-08-30', '2026-09-02');
  check('eachDay crosses a month end, both ends included',
    days.join(',') === '2026-08-30,2026-08-31,2026-09-01,2026-09-02', days.join(','));
  check('eachDay is empty when from is later', eachDay('2026-09-02', '2026-09-01').length === 0);

  // A phone with rows on two days 85 days apart, all of it known history.
  const zero = (date: string) => ({ date, total: 0 as number | null });
  const none = (date: string) => ({ date, total: null as number | null });
  const sparse = fillDays(
    [{ date: '2026-06-28', total: 5 }, { date: '2026-09-21', total: 7 }],
    '2026-06-28', '2026-09-21', [{ first: '2026-06-28', last: '2026-09-21' }], zero, none,
  );
  check('fill gives one point per day across the span', sparse.length === 86, `got ${sparse.length}`);
  check('fill keeps the real rows at the ends',
    sparse[0]!.total === 5 && sparse[85]!.total === 7);
  check('a day inside known history with no rows is 0, not missing',
    sparse.find((d) => d.date === '2026-08-01')?.total === 0);

  const edge = fillDays(
    [{ date: '2026-07-04', total: 9 }],
    '2026-06-30', '2026-07-04', [{ first: '2026-07-01', last: '2026-07-02' }], zero, none,
  );
  check('a day outside known history is null, never 0',
    edge.map((d) => d.total).join(',') === ',0,0,,9', edge.map((d) => String(d.total)).join(','));
  check('a row wins even outside known history', edge[4]!.total === 9);

  // Collector windows at UTC+6, fixed rather than the machine's zone so the
  // test means the same thing anywhere.
  const utc6 = (d: Date) => new Date(d.getTime() + 6 * 3_600_000).toISOString().slice(0, 10);
  const covered = coveredDays([
    // Overlapping windows, as consecutive daily runs always are. The first
    // starts mid-day locally (19:24) and the last ends mid-day, so both edge
    // days are partial and excluded.
    { oldest: '2026-06-27T13:24:00Z', newest: '2026-08-20T17:20:00Z' },
    { oldest: '2026-08-01T00:00:00Z', newest: '2026-08-30T08:01:00Z' },
    // A later run after an outage: starts exactly at local midnight on Oct 2.
    { oldest: '2026-10-01T18:00:00Z', newest: '2026-10-05T12:00:00Z' },
  ], utc6);
  check('overlapping windows merge; partial edge days are excluded',
    covered[0]?.first === '2026-06-28' && covered[0]?.last === '2026-08-29',
    JSON.stringify(covered[0]));
  check('a window starting at local midnight covers that day',
    covered[1]?.first === '2026-10-02' && covered[1]?.last === '2026-10-04',
    JSON.stringify(covered[1]));
  check('a stretch no window read stays unknown',
    covered.length === 2 && !isKnown('2026-09-15', covered) && isKnown('2026-08-29', covered));

  check('span label counts known days and active ones',
    daySpanLabel([{ total: 0 }, { total: 5 }, { total: null }]) === '2 days, 1 with traffic');
  check('span label is plain when every day moved data',
    daySpanLabel([{ total: 1 }]) === '1 day');
}

/* ------------------------------------------------------------------ */
/* Android ingest                                                      */
/* ------------------------------------------------------------------ */

function androidPayload(over: Partial<AndroidPayload> = {}): AndroidPayload {
  return {
    deviceId: 'selftest-device-0001',
    brand: 'Google', model: 'Pixel 8', release: '16', sdk: 36,
    utcOffsetMinutes: 360,
    apps: [
      { uid: 10181, package: 'com.google.android.youtube', label: 'YouTube', isSystem: false },
      { uid: 99910274, package: 'com.facebook.katana', label: 'Facebook', isSystem: false },
    ],
    buckets: [],
    ...over,
  };
}

function androidChecks(): void {
  console.log('\n== android ingest ==');

  // 2026-08-26T00:00:00Z, a real 2-hour bucket boundary.
  const T = Date.UTC(2026, 7, 26, 0, 0, 0);
  const dir = mkdtempSync(join(tmpdir(), 'du-android-'));
  const dbPath = join(dir, 'android.db');
  const opts = { dbPath, allowSystemDrive: true };

  try {
    // The phone's offset decides the day, not the server's. At UTC+6 midnight
    // UTC is 06:00 the same morning; at UTC-6 it is 18:00 the day BEFORE. This
    // is the Android side of the trap that shifted every Windows daily total.
    const east = localParts(T, 360);
    const west = localParts(T, -360);
    check('local bucket uses the DEVICE offset, not the server',
      east.date === '2026-08-26' && east.hour === 6
      && west.date === '2026-08-25' && west.hour === 18,
      `${east.date} ${east.hour} / ${west.date} ${west.hour}`);

    // A partial reading of a bucket that is still filling.
    const first = ingestAndroid(androidPayload({
      buckets: [
        { uid: 10181, start: T, network: 'wifi', metered: false, roaming: false, rx: 1000, tx: 100 },
        { uid: 10181, start: T, network: 'mobile', metered: true, roaming: false, rx: 50, tx: 5 },
      ],
    }), opts);
    check('first upload writes both buckets', first.written === 2, `got ${first.written}`);

    // The SAME bucket, re-read later in its window, now larger. This is what
    // makes the Windows dedup strategy wrong here: with bytes in the key this
    // would become a second row and double-count the overlap.
    const second = ingestAndroid(androidPayload({
      buckets: [
        { uid: 10181, start: T, network: 'wifi', metered: false, roaming: false, rx: 4000, tx: 400 },
      ],
    }), opts);
    check('a fuller reading of the same bucket does not add a row',
      second.written === 0, `wrote ${second.written}`);

    const db = new DatabaseSync(dbPath);
    const wifi = db.prepare(
      `SELECT rx_bytes r, tx_bytes t FROM android_usage_records
       WHERE uid = 10181 AND network = 'wifi'`,
    ).get() as { r: number; t: number };
    check('it updates the existing row to the larger total',
      Number(wifi.r) === 4000 && Number(wifi.t) === 400, `rx ${wifi.r} tx ${wifi.t}`);

    // ...and a stale partial arriving late must not shrink it.
    ingestAndroid(androidPayload({
      buckets: [
        { uid: 10181, start: T, network: 'wifi', metered: false, roaming: false, rx: 9, tx: 1 },
      ],
    }), opts);
    const afterStale = db.prepare(
      `SELECT rx_bytes r FROM android_usage_records WHERE uid = 10181 AND network = 'wifi'`,
    ).get() as { r: number };
    check('a stale partial cannot shrink a bucket',
      Number(afterStale.r) === 4000, `got ${afterStale.r}`);

    const total = db.prepare('SELECT COUNT(*) c FROM android_usage_records').get() as { c: number };
    check('three uploads of one bucket leave one row', Number(total.c) === 2, `got ${total.c}`);

    // uid 99910274 = user profile 999 x appId 10274. Storing the profile keeps
    // a cloned app distinguishable instead of merged into the original, which
    // carries a completely different uid.
    const clone = db.prepare(
      'SELECT user_profile p FROM android_apps WHERE uid = 99910274',
    ).get() as { p: number };
    check('a cloned app records its user profile', Number(clone.p) === 999, `got ${clone.p}`);
    db.close();

    // Validation rejects rather than storing something half-valid.
    const rejects = (body: unknown, why: string) => {
      try { validatePayload(body); check(`rejects ${why}`, false, 'accepted it'); }
      catch { check(`rejects ${why}`, true); }
    };
    rejects({ ...androidPayload(), deviceId: 'short' }, 'a too-short deviceId');
    rejects({ ...androidPayload(), utcOffsetMinutes: 20 * 60 }, 'an impossible utc offset');
    rejects({
      ...androidPayload(),
      buckets: [{ uid: 1, start: T, network: 'ethernet', metered: false, roaming: false, rx: 1, tx: 1 }],
    }, 'an unknown network type');
    rejects({
      ...androidPayload(),
      buckets: [{ uid: 1, start: 12345, network: 'wifi', metered: false, roaming: false, rx: 1, tx: 1 }],
    }, 'a bucket start that is not epoch ms');
    rejects({
      ...androidPayload(),
      buckets: [{ uid: 1, start: T, network: 'wifi', metered: false, roaming: false, rx: -1, tx: 1 }],
    }, 'negative bytes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* Security                                                            */
/* ------------------------------------------------------------------ */

/**
 * The login gate and the ingest validator. Every case below is a way the gate
 * could be opened, or bad data let in, while the page kept working normally.
 */
async function securityChecks(): Promise<void> {
  console.log('\n== security ==');

  // Post-login redirect. The backslash case is the one that shipped: the old
  // guard ("starts with / and not //") passed it, and the browser resolved it
  // to another origin.
  const keeps = (raw: string) => check(`redirect keeps ${JSON.stringify(raw)}`, safeNextPath(raw) === raw,
    `got ${safeNextPath(raw)}`);
  const home = (raw: string | null) => check(`redirect refuses ${JSON.stringify(raw)}`, safeNextPath(raw) === '/',
    `got ${safeNextPath(raw)}`);
  keeps('/windows/my-pc/apps?days=30&profile=268435457');
  keeps('/android/x/apps/10181#top');
  keeps('/%5Cstill-a-local-path');
  home(null);
  home('');
  home('//evil.example');
  home('/\\evil.example');
  home('/\\/evil.example');
  home('/\t/evil.example');
  home('https://evil.example/');
  home('javascript:alert(1)');
  home('windows/relative');

  // Same-origin check on state-changing calls. The first three are what real
  // browsers send, and the first version refused all of them: it compared
  // Origin with a URL Next builds from the BIND address (-H 127.0.0.1 or
  // 0.0.0.0), which no browser ever sends as its origin.
  const origin = (name: string, want: boolean, site: string | null, o: string | null, host: string | null) =>
    check(`origin check ${want ? 'allows' : 'refuses'} ${name}`,
      isSameOrigin({ site, origin: o, host }) === want);
  origin('a login from localhost', true, 'same-origin', 'http://localhost:7843', 'localhost:7843');
  origin('a login from 127.0.0.1', true, 'same-origin', 'http://127.0.0.1:7843', '127.0.0.1:7843');
  origin('a login from a LAN address', true, 'same-origin', 'http://192.0.2.10:7843', '192.0.2.10:7843');
  origin('an older browser without Sec-Fetch-Site', true, null, 'http://localhost:7843', 'localhost:7843');
  origin('a client sending neither header', true, null, null, 'localhost:7843');
  origin('a sibling dashboard on another port', false, 'same-site', 'http://localhost:7842', 'localhost:7843');
  origin('another port when Sec-Fetch-Site is absent', false, null, 'http://localhost:7842', 'localhost:7843');
  origin('another site', false, 'cross-site', 'https://evil.example', 'localhost:7843');
  origin('Origin: null', false, null, 'null', 'localhost:7843');
  origin('a missing Host', false, 'same-origin', 'http://localhost:7843', null);

  // ?days= goes straight into Date arithmetic. 1e9 used to reach it and throw
  // RangeError, taking the page down; anything unbounded or fractional must
  // fall back, while an old ?days=365 bookmark keeps working.
  const days = (raw: string | undefined, want: number) =>
    check(`?days=${raw} -> ${want}`, parseDays(raw) === want, `got ${parseDays(raw)}`);
  days('30', 30);
  days('365', 365);
  days(String(ALL_DAYS), ALL_DAYS);
  days('1e9', DEFAULT_DAYS);
  days(String(ALL_DAYS + 1), DEFAULT_DAYS);
  days('0', DEFAULT_DAYS);
  days('-7', DEFAULT_DAYS);
  days('7.5', DEFAULT_DAYS);
  days('abc', DEFAULT_DAYS);
  days(undefined, DEFAULT_DAYS);

  // The login throttle, on an injected clock.
  const o = DEFAULT_THROTTLE;
  const t = new LoginThrottle();
  let now = 1_000_000;
  for (let i = 0; i < o.maxFailures - 1; i++) t.recordFailure(now + i);
  check('throttle allows attempts under the budget', t.check(now + 20).allowed);
  t.recordFailure(now + 20);
  const locked = t.check(now + 21);
  check('throttle locks once the budget is spent', !locked.allowed);
  check('first lock lasts the base period',
    !locked.allowed && Math.abs(locked.retryAfterMs - (o.baseLockMs - 1)) <= 1,
    JSON.stringify(locked));
  now += 20 + o.baseLockMs + 1;
  check('lock lifts after its period', t.check(now).allowed);
  for (let i = 0; i < o.maxFailures; i++) t.recordFailure(now + i);
  const second = t.check(now + o.maxFailures);
  check('a second lock doubles',
    !second.allowed && second.retryAfterMs > o.baseLockMs * 1.9, JSON.stringify(second));
  const spaced = new LoginThrottle();
  for (let i = 0; i < o.maxFailures * 3; i++) spaced.recordFailure(i * (o.windowMs / 2));
  check('failures spread wider than the window never lock',
    spaced.check(o.maxFailures * 3 * (o.windowMs / 2)).allowed);
  const reset = new LoginThrottle();
  for (let i = 0; i < o.maxFailures; i++) reset.recordFailure(i);
  reset.recordSuccess();
  const lateNow = o.baseLockMs + 10;
  for (let i = 0; i < o.maxFailures; i++) reset.recordFailure(lateNow + i);
  const afterSuccess = reset.check(lateNow + o.maxFailures);
  check('the right password resets escalation',
    !afterSuccess.allowed && afterSuccess.retryAfterMs <= o.baseLockMs, JSON.stringify(afterSuccess));

  // Sessions.
  const pw = 'correct horse battery staple';
  const { value } = await issueSession(pw);
  check('a fresh session verifies', await verifySession(pw, value));
  check('it does not verify under another password', !(await verifySession(`${pw}!`, value)));
  const [exp, sig] = [value.slice(0, value.lastIndexOf('.')), value.slice(value.lastIndexOf('.') + 1)];
  check('a stretched expiry is refused', !(await verifySession(pw, `${Number(exp) + 1}.${sig}`)));
  check('garbage is refused', !(await verifySession(pw, 'not-a-cookie')));
  // The pre-2026-09-21 format: HMAC keyed by the password itself. Proves the
  // key really is derived now, since a sniffed cookie of that shape was an
  // offline password oracle.
  const raw = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const oldSig = Buffer.from(await crypto.subtle.sign('HMAC', raw, new TextEncoder().encode(exp)))
    .toString('base64url');
  check('a cookie signed with the raw password is refused', !(await verifySession(pw, `${exp}.${oldSig}`)));

  const saved = process.env['DASHBOARD_PASSWORD'];
  try {
    delete process.env['DASHBOARD_PASSWORD'];
    check('no password is "unset"', passwordStatus() === 'unset');
    process.env['DASHBOARD_PASSWORD'] = '   ';
    check('a blank password is "unset"', passwordStatus() === 'unset');
    process.env['DASHBOARD_PASSWORD'] = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);
    check('a short password fails closed', passwordStatus() === 'too-short');
    process.env['DASHBOARD_PASSWORD'] = 'x'.repeat(MIN_PASSWORD_LENGTH);
    check('a long-enough password is accepted', passwordStatus() === 'ok');
  } finally {
    if (saved === undefined) delete process.env['DASHBOARD_PASSWORD'];
    else process.env['DASHBOARD_PASSWORD'] = saved;
  }

  // Ingest validation beyond the buckets. A realistic payload must still pass.
  const now2 = Date.UTC(2026, 8, 21, 12, 0, 0);
  const bucket = { uid: 10181, start: now2 - 3_600_000, network: 'wifi', metered: false, roaming: false, rx: 10, tx: 1 };
  let accepted = true;
  try { validatePayload(androidPayload({ label: 'Google Pixel 8', appVersion: '1.2', buckets: [bucket] }), now2); }
  catch { accepted = false; }
  check('a realistic upload is accepted', accepted);
  const rejects = (body: unknown, why: string) => {
    try { validatePayload(body, now2); check(`rejects ${why}`, false, 'accepted it'); }
    catch { check(`rejects ${why}`, true); }
  };
  rejects(androidPayload({ buckets: [{ ...bucket, uid: 1.5 }] }), 'a fractional uid');
  rejects(androidPayload({ buckets: [{ ...bucket, start: now2 + 3 * 86_400_000 }] }), 'a bucket days in the future');
  rejects(androidPayload({ buckets: [{ ...bucket, rx: 2 ** 60 }] }), 'bytes past the safe-integer range');
  rejects(androidPayload({ apps: [{ uid: 1, package: '', label: 'x', isSystem: false }] }), 'an app with no package');
  rejects(androidPayload({ apps: [{ uid: 1, package: 'a.b', label: 'x'.repeat(300), isSystem: false }] }), 'an oversized app label');
  rejects(androidPayload({ apps: [null as never] }), 'a null app entry');
  rejects({ ...androidPayload(), model: 42 }, 'a non-string model');
  rejects({ ...androidPayload(), utcOffsetMinutes: 90.5 }, 'a fractional utc offset');
  rejects([], 'an array body');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
