/**
 * Phase 1 for the Android half: prove the data source before trusting it.
 *
 * The counterpart of `phase1-validate.ps1`, and it exists for the same reason.
 * `dumpsys netstats` is not a documented contract -- its sections and field
 * names shift between Android versions and OEM skins. Writing a parser against
 * remembered format and finding out later that the numbers are quietly wrong is
 * exactly the failure this project cannot afford, because by then the history is
 * already stored.
 *
 * Needs USB debugging and a connected device. Does NOT need root, and does NOT
 * need Administrator -- a real advantage over the Windows collector.
 *
 *   npx tsx scripts/android-validate.ts
 *
 * Captures land in `<scratchDir>/android/<timestamp>/`, outside the repo and
 * outside the Drive-synced tree.
 *
 * ---------------------------------------------------------------------------
 * MEASURED against an Android 16 (API 36) phone, 2026-08-26.
 *
 * The per-app history lives in the `UID stats:` section, which appears ONLY in
 * `dumpsys netstats detail` -- not in `--full`, which carries just 29 uids of
 * interface-level data. Format:
 *
 *   ident=[{type=-1, ratType=COMBINED, metered=false, defaultNetwork=false,
 *           oemManaged=OEM_NONE, subId=-1, transports={1}}]
 *           uid=10181 set=DEFAULT tag=0x0
 *     NetworkStatsHistory: bucketDuration=7200
 *       st=1783684800 rb=0 rp=0 tb=460 tp=4 op=0
 *
 * Four things in that block that are easy to get wrong:
 *
 * - `bucketDuration` and `st` are in SECONDS, not milliseconds. 7200 = the
 *   2-hour AOSP uid bucket. Reading them as ms puts every timestamp in 1970.
 * - `transports={0, 1}` contains a comma INSIDE the braces, so splitting the
 *   ident on commas mangles it. Pull `transports={...}` out first.
 * - One uid appears once per `set=` (DEFAULT and FOREGROUND). Those must be
 *   SUMMED. This is the opposite of the SRUM aggregate trap and just as easy to
 *   get backwards.
 * - Transport 4 is VPN, and a VPN network reports BOTH its underlying transport
 *   and 4, e.g. `transports={1, 4}`. Summing the raw dump double-counts every
 *   byte that crossed a VPN. See the VPN check below.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ------------------------------------------------------------------ */
/* Locating adb                                                        */
/* ------------------------------------------------------------------ */

function adbPath(): string {
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    join(local, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    join(local, 'Android', 'sdk', 'platform-tools', 'adb.exe'),
    'adb',
  ];
  for (const c of candidates) if (c === 'adb' || existsSync(c)) return c;
  throw new Error('adb not found. Install Android platform-tools.');
}

const ADB = adbPath();

function adb(args: string[], allowFail = false): string {
  try {
    return execFileSync(ADB, args, {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true,
    });
  } catch (err) {
    if (allowFail) return `__FAILED__ ${(err as Error).message}`;
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

/**
 * `dumpsys netstats` puts the SIM's IMSI in every mobile `ident=` block, as
 * `subscriberId=`. Measured PRESENT on Android 16 / API 36 -- the newer `subId`
 * field sits beside it rather than replacing it, so "this is a modern build" is
 * not a reason to skip this pass.
 *
 * The IMSI is a permanent subscriber identifier, more sensitive than anything
 * else this project stores, and it has no analytical value: mobile data is
 * mobile data. It is stripped before anything reaches disk, and section 3
 * asserts afterwards that none survived. Do not "improve" this by capturing raw
 * and redacting on display.
 *
 * SSIDs (`wifiNetworkKey=`) are deliberately NOT stripped. They are the data --
 * the Windows half runs a whole observe-and-vote subsystem to guess network
 * names that this dump simply states.
 */
function redact(text: string): string {
  return text
    .replace(/subscriberId=[^,\]\s}]*/g, 'subscriberId=<redacted>')
    .replace(/subscriberIds=\[[^\]]*\]/g, 'subscriberIds=[<redacted>]')
    .replace(/imsi=[^,\]\s}]*/g, 'imsi=<redacted>');
}

/* ------------------------------------------------------------------ */
/* Probes                                                              */
/* ------------------------------------------------------------------ */

interface Probe { name: string; args: string[]; file: string; optional?: boolean }

/**
 * Ordered richest-first. `detail` is the only one carrying `UID stats:` on
 * API 36 -- an earlier version of this script preferred `--full` because it is
 * smaller, analysed 29 uids of interface totals, and reported "no UID stats
 * section" for a device that has 128 of them.
 */
const PROBES: Probe[] = [
  { name: 'netstats detail', args: ['shell', 'dumpsys', 'netstats', 'detail'], file: 'netstats-detail.txt' },
  { name: 'netstats --uid', args: ['shell', 'dumpsys', 'netstats', '--uid'], file: 'netstats-uid.txt', optional: true },
  { name: 'netstats --full', args: ['shell', 'dumpsys', 'netstats', '--full'], file: 'netstats-full.txt', optional: true },
  { name: 'netstats (plain)', args: ['shell', 'dumpsys', 'netstats'], file: 'netstats.txt', optional: true },
  { name: 'device properties', args: ['shell', 'getprop'], file: 'getprop.txt' },
  { name: 'package -> uid map', args: ['shell', 'pm', 'list', 'packages', '-U'], file: 'packages-uid.txt' },
  { name: 'installed packages (paths)', args: ['shell', 'pm', 'list', 'packages', '-f'], file: 'packages-paths.txt', optional: true },
];

const RETENTION_KEYS = [
  'netstats_uid_bucket_duration', 'netstats_uid_rotate_age', 'netstats_uid_delete_age',
  'netstats_dev_bucket_duration', 'netstats_dev_rotate_age', 'netstats_dev_delete_age',
  'netstats_uid_tag_bucket_duration', 'netstats_uid_tag_delete_age', 'netstats_poll_interval',
];

/* ------------------------------------------------------------------ */
/* Parsing the measured format                                         */
/* ------------------------------------------------------------------ */

/** Android's ConnectivityManager transport constants, as they appear in ident. */
const TRANSPORT: Record<string, string> = {
  '0': 'CELLULAR', '1': 'WIFI', '2': 'BLUETOOTH', '3': 'ETHERNET', '4': 'VPN',
  '5': 'WIFI_AWARE', '6': 'LOWPAN', '7': 'TEST', '8': 'USB', '9': 'THREAD',
  '10': 'SATELLITE',
};

interface Bucket {
  uid: number;
  set: string;
  transports: string;
  metered: boolean;
  start: number;   // ms
  rx: number;
  tx: number;
}

function parseUidStats(dump: string): { buckets: Bucket[]; bucketSeconds: Set<number> } {
  // `UID tag stats:` is a separate, per-socket section with much shorter
  // retention. Slice it off rather than parsing it by accident.
  const from = dump.indexOf('\nUID stats:');
  if (from < 0) return { buckets: [], bucketSeconds: new Set() };
  const to = dump.indexOf('\nUID tag stats:', from);
  const section = dump.slice(from, to < 0 ? undefined : to);

  const buckets: Bucket[] = [];
  const bucketSeconds = new Set<number>();
  let cur: Omit<Bucket, 'start' | 'rx' | 'tx'> | null = null;

  for (const line of section.split(/\r?\n/)) {
    const ident = /^\s*ident=\[\{(.*)\}\]\s+uid=(-?\d+)\s+set=(\w+)\s+tag=(\S+)/.exec(line);
    if (ident) {
      const body = ident[1]!;
      // transports={0, 1} holds a comma inside its braces; take it out before
      // splitting the rest of the ident on commas.
      const tr = /transports=\{([^}]*)\}/.exec(body);
      const rest = body.replace(/transports=\{[^}]*\}/, '');
      const fields = Object.fromEntries(
        [...rest.matchAll(/(\w+)=([^,]+)/g)].map((m) => [m[1]!, m[2]!.trim()]),
      );
      cur = {
        uid: Number(ident[2]),
        set: ident[3]!,
        transports: tr ? tr[1]!.split(',').map((s) => s.trim()).sort().join(',') : '',
        metered: fields['metered'] === 'true',
      };
      continue;
    }
    const bd = /bucketDuration=(\d+)/.exec(line);
    if (bd) { bucketSeconds.add(Number(bd[1])); continue; }
    const st = /^\s*st=(\d+) rb=(\d+) rp=\d+ tb=(\d+) tp=\d+/.exec(line);
    if (st && cur) {
      buckets.push({ ...cur, start: Number(st[1]) * 1000, rx: Number(st[2]), tx: Number(st[3]) });
    }
  }
  return { buckets, bucketSeconds };
}

/** `package:com.foo uid:10123` -> uid -> packages. */
function packagesByUid(list: string): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const m of list.matchAll(/^package:(\S+)\s+uid:(\d+)/gm)) {
    const uid = Number(m[2]);
    map.set(uid, [...(map.get(uid) ?? []), m[1]!]);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Report helpers                                                      */
/* ------------------------------------------------------------------ */

const C = {
  head: (s: string) => `\n\x1b[36m=== ${s} ===\x1b[0m`,
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
};
let failures = 0;
let warnings = 0;
const ok = (s: string) => console.log(`  \x1b[32m[OK]\x1b[0m   ${s}`);
const warn = (s: string) => { console.log(`  \x1b[33m[WARN]\x1b[0m ${s}`); warnings++; };
const bad = (s: string) => { console.log(`  \x1b[31m[FAIL]\x1b[0m ${s}`); failures++; };
const GB = (b: number) => `${(b / 1073741824).toFixed(2)} GB`;

function scratchDir(): string {
  const cfg = JSON.parse(
    readFileSync(join(process.cwd(), 'config', 'collector.json'), 'utf8'),
  ) as { scratchDir: string };
  return cfg.scratchDir;
}

function prop(getprop: string, key: string): string | null {
  const m = new RegExp(`^\\[${key.replace(/\./g, '\\.')}\\]: \\[(.*)\\]$`, 'm').exec(getprop);
  return m ? m[1]! : null;
}

/* ------------------------------------------------------------------ */

function main(): void {
  console.log(C.head('0. adb and device'));
  console.log(C.dim(`  adb: ${ADB}`));

  const attached = adb(['devices', '-l']).split(/\r?\n/).slice(1)
    .map((l) => l.trim()).filter(Boolean).filter((l) => !l.startsWith('*'));

  if (attached.length === 0) {
    bad('No device attached. Plug the phone in, enable Developer options -> USB debugging.');
    process.exit(1);
  }
  if (attached.some((l) => /unauthorized/.test(l))) {
    bad('Device attached but UNAUTHORIZED. Unlock it and accept the debugging prompt.');
    process.exit(1);
  }
  if (attached.length > 1) {
    bad(`${attached.length} devices attached; this script expects exactly one.`);
    process.exit(1);
  }
  ok(`one device attached: ${attached[0]}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(scratchDir(), 'android', stamp);
  mkdirSync(outDir, { recursive: true });
  console.log(C.dim(`  capturing to ${outDir}`));

  /* ---------------------------------------------------------------- */
  console.log(C.head('1. What phone is this'));

  const getprop = adb(['shell', 'getprop']);
  const brand = prop(getprop, 'ro.product.brand') ?? '?';
  const model = prop(getprop, 'ro.product.model') ?? '?';
  const release = prop(getprop, 'ro.build.version.release') ?? '?';
  const sdk = Number(prop(getprop, 'ro.build.version.sdk') ?? 0);
  const serial = attached[0]!.split(/\s+/)[0]!;
  ok(`${brand} ${model} - Android ${release} (API ${sdk})`);

  if (sdk < 23) bad('NetworkStatsManager needs API 23+. Too old for the app route.');
  else if (sdk < 29) warn('API < 29: querySummary handles subscriber ids differently; the app needs a branch.');
  else ok('API supports NetworkStatsManager.querySummary with a null subscriber id');

  /* ---------------------------------------------------------------- */
  console.log(C.head('2. Capturing'));

  const captured = new Map<string, string>();
  for (const p of PROBES) {
    const raw = adb(p.args, true);
    if (raw.startsWith('__FAILED__')) {
      if (p.optional) warn(`${p.name}: not supported on this build`);
      else bad(`${p.name}: FAILED - ${raw.slice(0, 120)}`);
      continue;
    }
    const text = redact(raw);
    writeFileSync(join(outDir, p.file), text, 'utf8');
    captured.set(p.name, text);
    ok(`${p.name}: ${Math.round(text.length / 1024)} KB -> ${p.file}`);
  }

  /* ---------------------------------------------------------------- */
  console.log(C.head('3. Per-app history'));

  // Richest first. Only `detail` carries UID stats on API 36.
  const dump = captured.get('netstats detail') ?? captured.get('netstats --uid')
    ?? captured.get('netstats --full') ?? captured.get('netstats (plain)') ?? '';
  const { buckets, bucketSeconds } = parseUidStats(dump);

  if (buckets.length === 0) {
    bad('No UID stats parsed. The dump format has changed; re-probe before writing anything.');
    console.log(C.dim(`  sections present: ${[...new Set(dump.split(/\r?\n/).filter((l) => /^[A-Za-z][^:]{0,60}:\s*$/.test(l)))].join(', ')}`));
    process.exit(1);
  }

  ok(`${buckets.length.toLocaleString()} history rows across ${new Set(buckets.map((b) => b.uid)).size} uids`);

  const durs = [...bucketSeconds];
  if (durs.length === 1 && durs[0] === 7200) ok('bucketDuration 7200 s = the expected 2-hour AOSP uid bucket');
  else warn(`bucketDuration values: ${durs.join(', ')} seconds - expected a single 7200`);

  const starts = buckets.map((b) => b.start);
  const oldest = Math.min(...starts);
  const days = (Date.now() - oldest) / 86400000;
  ok(`history spans ${new Date(oldest).toISOString().slice(0, 10)} -> ${new Date(Math.max(...starts)).toISOString().slice(0, 10)} (${days.toFixed(0)} days)`);
  if (days < 21) warn('under 3 weeks retained - the phone would need connecting weekly');
  else console.log(C.dim(`  ${days.toFixed(0)} days retained means syncing monthly is comfortably lossless.`));

  const sets = [...new Set(buckets.map((b) => b.set))];
  if (sets.length > 1) {
    ok(`sets present: ${sets.join(', ')} - these are slices of one uid and MUST be summed`);
  }

  const REDACTED = 'subscriberId=<redacted>';
  const anySubscriber = dump.includes('subscriberId=');
  const leaked = anySubscriber
    && dump.split('subscriberId=').slice(1).some((tail) => !tail.startsWith('<redacted>'));
  if (leaked) bad('an unredacted subscriberId survived redact() - fix it before storing anything');
  else if (dump.includes(REDACTED)) ok('subscriber ids were present in the dump and are redacted');

  // The Windows half needs observe-and-vote machinery to learn which
  // L2ProfileId is which SSID. Android states it, per bucket, for free.
  const ssids = [...new Set([...dump.matchAll(/wifiNetworkKey=.(.*?).wpa/g)].map((m) => m[1]!))];
  if (ssids.length) {
    ok(`${ssids.length} Wi-Fi networks named in the dump: ${ssids.join(', ')}`);
    console.log(C.dim('  Network names come free on this side - no observation, no voting.'));
  }

  /* ---------------------------------------------------------------- */
  console.log(C.head('4. Double-counting hazards'));

  const total = buckets.reduce((a, b) => a + b.rx + b.tx, 0);
  const vpn = buckets.filter((b) => b.transports.split(',').includes('4'));
  const vpnBytes = vpn.reduce((a, b) => a + b.rx + b.tx, 0);
  const stacked = vpn.filter((b) => b.transports.split(',').length > 1);
  const stackedBytes = stacked.reduce((a, b) => a + b.rx + b.tx, 0);

  console.log(`  raw sum of every row: ${GB(total)}`);
  if (vpn.length) {
    warn(`VPN transport present: ${GB(vpnBytes)} carries transport 4`);
    console.log(C.dim(`         ${GB(stackedBytes)} of that is on a STACKED ident (e.g. transports={1, 4}),`));
    console.log(C.dim('         i.e. counted once for the tunnel and once for the carrier beneath it.'));
    console.log(C.dim('         NetworkStatsManager.querySummary() does this de-duplication for you.'));
    console.log(C.dim('         Parsing the raw dump does not. This is why the app route is the safe one.'));
  } else {
    ok('no VPN transport in the data');
  }

  const tether = buckets.filter((b) => b.uid === -5);
  if (tether.length) {
    const tb = tether.reduce((a, b) => a + b.rx + b.tx, 0);
    warn(`uid -5 (tethering) carries ${GB(tb)} - traffic this phone relayed for other devices`);
    console.log(C.dim('         Your PC tethers off this phone, so those bytes are ALSO in usage_records.'));
    console.log(C.dim('         Never sum the phone total and the PC total. Store it, label it, keep it apart.'));
  }

  const removed = buckets.filter((b) => b.uid === -4);
  if (removed.length) {
    ok(`uid -4 (uninstalled apps) carries ${GB(removed.reduce((a, b) => a + b.rx + b.tx, 0))}`);
  }

  // -1 UID_ALL, -4 UID_REMOVED and -5 UID_TETHERING are documented constants.
  // Anything else is not, and the honest response is to measure it rather than
  // invent a meaning for it. Measured on API 36: uid -253 carries 0.043% of the
  // raw total, almost all of it upload, always on defaultNetwork=true, across
  // every SIM and every SSID. Small enough to store as a labelled pseudo-app;
  // too unexplained to fold silently into a named one.
  const KNOWN_NEGATIVE = new Set([-1, -4, -5]);
  const odd = [...new Set(buckets.filter((b) => b.uid < 0 && !KNOWN_NEGATIVE.has(b.uid)).map((b) => b.uid))];
  for (const uid of odd) {
    const bytes = buckets.filter((b) => b.uid === uid).reduce((a, b) => a + b.rx + b.tx, 0);
    warn(`undocumented uid ${uid}: ${GB(bytes)} (${((bytes / total) * 100).toFixed(3)}% of raw total)`);
    console.log(C.dim('         store it labelled; do not fold it into a named app'));
  }

  /* ---------------------------------------------------------------- */
  console.log(C.head('5. Naming the uids'));

  const pkgs = packagesByUid(captured.get('package -> uid map') ?? '');
  ok(`${[...pkgs.values()].reduce((a, l) => a + l.length, 0)} packages mapped to ${pkgs.size} uids`);

  const shared = [...pkgs.entries()].filter(([, l]) => l.length > 1);
  if (shared.length) {
    warn(`${shared.length} uids are SHARED by several packages - a uid is not an app`);
    shared.sort((a, b) => b[1].length - a[1].length).slice(0, 3)
      .forEach(([uid, l]) => console.log(C.dim(`         uid ${uid}: ${l.length} packages, e.g. ${l.slice(0, 3).join(', ')}`)));
  }

  // uid = userId * 100000 + appId. A cloned or work-profile app has the same
  // appId under a different user, so it is absent from `pm list packages -U`
  // and looks like an unknown uid unless it is decomposed.
  const multiUser = [...new Set(buckets.map((b) => b.uid))]
    .filter((u) => u >= 100000)
    .map((u) => ({ uid: u, user: Math.floor(u / 100000), app: u % 100000 }));
  if (multiUser.length) {
    warn(`${multiUser.length} uids belong to a secondary user or cloned app`);
    multiUser.slice(0, 3).forEach((m) => {
      const base = pkgs.get(m.app)?.[0] ?? `appId ${m.app}`;
      console.log(C.dim(`         uid ${m.uid} = user ${m.user} x ${base}`));
    });
    console.log(C.dim('         Decompose with uid % 100000, and label the clone distinctly.'));
  }

  /* ---------------------------------------------------------------- */
  console.log(C.head('6. Ground truth - compare these against Settings'));

  const since = Date.now() - 30 * 86400000;
  const recent = buckets.filter((b) => b.start >= since);
  const bytesOf = (f: (b: Bucket) => boolean) => GB(recent.filter(f).reduce((a, b) => a + b.rx + b.tx, 0));

  console.log(`  last 30 days, Wi-Fi only  : ${bytesOf((b) => b.transports === '1')}`);
  console.log(`  last 30 days, mobile only : ${bytesOf((b) => b.transports === '0')}`);
  console.log(C.dim('  ("only" = no VPN stacked on top, so these are the comparable figures)'));

  const byUid = new Map<number, number>();
  for (const b of recent) byUid.set(b.uid, (byUid.get(b.uid) ?? 0) + b.rx + b.tx);
  console.log('\n  top apps, last 30 days, all transports:');
  for (const [uid, bytes] of [...byUid].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    const names = pkgs.get(uid) ?? pkgs.get(uid % 100000);
    const label = uid === -5 ? '<tethering / hotspot>'
      : uid === -4 ? '<uninstalled apps>'
        : names ? (names.length > 1 ? `${names[0]} (+${names.length - 1} sharing uid)` : names[0]!)
          : `<unmapped uid ${uid}>`;
    console.log(`    ${GB(bytes).padStart(10)}  ${label}`);
  }
  console.log(C.dim('\n  Settings -> Network & internet -> Data usage should agree with the'));
  console.log(C.dim('  per-transport figures above. If it does not, stop and find out why.'));

  /* ---------------------------------------------------------------- */
  console.log(C.head('7. Retention settings (null = AOSP default)'));

  const retention: Record<string, string> = {};
  for (const key of RETENTION_KEYS) {
    retention[key] = adb(['shell', 'settings', 'get', 'global', key], true).trim();
    console.log(`    ${key.padEnd(34)} ${retention[key]}`);
  }
  writeFileSync(join(outDir, 'retention.json'), JSON.stringify(retention, null, 2), 'utf8');
  console.log(C.dim('  All null = AOSP defaults: uid buckets 2h, deleted at 90 days.'));

  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({
    capturedAt: new Date().toISOString(),
    device: { serial, brand, model, release, sdk },
    historyRows: buckets.length,
    uids: new Set(buckets.map((b) => b.uid)).size,
    bucketSeconds: [...bucketSeconds],
    oldestBucket: new Date(oldest).toISOString(),
    retainedDays: Number(days.toFixed(1)),
    rawTotalBytes: total,
    vpnBytes, stackedVpnBytes: stackedBytes,
    tetheringBytes: tether.reduce((a, b) => a + b.rx + b.tx, 0),
  }, null, 2), 'utf8');

  /* ---------------------------------------------------------------- */
  console.log(C.head('Result'));
  console.log(`  captured to ${outDir}`);
  if (failures > 0) {
    console.log(`  \x1b[31m${failures} failure(s)\x1b[0m and ${warnings} warning(s). Do not build on this yet.`);
    process.exit(1);
  }
  console.log(`  \x1b[32mSource verified\x1b[0m with ${warnings} warning(s) - read them, they are the design constraints.`);
}

main();
