/**
 * Collect per-app, per-SSID usage from a phone over USB.
 *
 *   npx tsx scripts/android-ssid-collect.ts
 *
 * No root and no elevation. The phone must be plugged in with USB debugging
 * authorised.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Android records per-app traffic per SSID and does not expose it to apps.
 * Every public `NetworkStatsManager` method takes `(networkType, subscriberId)`
 * and nothing else, and `android.net.NetworkTemplate` -- the class carrying a
 * wifi network key -- is absent from the public SDK entirely. Verified against
 * `android-36/android.jar`: "class not found".
 *
 * So the reporter app collects everything else automatically, and this one
 * dimension is picked up over a cable. That is a real cost and it is worth
 * being clear about: **this script is the only part of the project that needs
 * the phone physically present.**
 *
 * It is not needed often. Android retains ~90 days, so running this monthly
 * loses nothing -- the same "collect faster than eviction, not faster than
 * writing" rule as the Windows collector.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT COVER, measured rather than assumed
 *
 * Only Wi-Fi rows carry an SSID. Mobile data has none, and neither does
 * anything that crossed a VPN: a VPN network is reported on a STACKED ident
 * (`transports={1, 4}`) and those carry no `wifiNetworkKey` at all. Measured on
 * a real device: gigabytes on stacked idents, of which 0 bytes were SSID-labelled.
 *
 * That cuts both ways, and both directions matter:
 *
 * - Filtering to "has an SSID" excludes the VPN double-count for free. There is
 *   no risk of counting those bytes twice here.
 * - VPN traffic is therefore ABSENT from this table, not mis-attributed. The
 *   per-SSID totals will fall short of the app's Wi-Fi total by however much
 *   crossed a VPN. The dashboard says so rather than quietly reconciling.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../src/lib/db';

/* ------------------------------------------------------------------ */
/* adb                                                                 */
/* ------------------------------------------------------------------ */

function adbPath(): string {
  const local = process.env.LOCALAPPDATA ?? '';
  for (const c of [
    join(local, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    join(local, 'Android', 'sdk', 'platform-tools', 'adb.exe'),
    'adb',
  ]) {
    if (c === 'adb' || existsSync(c)) return c;
  }
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
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

interface Row {
  uid: number;
  start: number;   // epoch ms
  ssid: string;
  metered: boolean;
  rx: number;
  tx: number;
}

/**
 * Pull SSID-labelled buckets out of the `UID stats:` section.
 *
 * The format was measured in `android-validate.ts` and its four traps apply
 * here unchanged: the section exists only when `detail` is passed,
 * `bucketDuration` and `st` are in SECONDS, `transports={0, 1}` hides a comma
 * inside its braces, and one uid appears once per `set=` so those must be
 * SUMMED.
 */
function parse(dump: string): { rows: Row[]; skippedNoSsid: number; buckets: number } {
  const from = dump.indexOf('\nUID stats:');
  if (from < 0) throw new Error('No "UID stats:" section. Use `dumpsys netstats --full detail`.');
  const to = dump.indexOf('\nUID tag stats:', from);
  const section = dump.slice(from, to < 0 ? undefined : to);

  // Sum within one capture; a later capture supersedes via MAX() on write.
  // Several idents can land on the same key -- different process state, or a
  // defaultNetwork flag the dashboard does not key on -- and those are slices
  // of one figure, not separate measurements.
  const merged = new Map<string, Row>();
  let cur: { uid: number; ssid: string | null; metered: boolean } | null = null;
  let skippedNoSsid = 0;
  let buckets = 0;

  for (const line of section.split(/\r?\n/)) {
    const ident = /^\s*ident=\[\{(.*)\}\]\s+uid=(-?\d+)\s+set=(\w+)\s+tag=(\S+)/.exec(line);
    if (ident) {
      const body = ident[1]!;
      // `wifiNetworkKey` on API 33+, `networkId` before it -- AOSP renamed the
      // field in Android 13. Matching only the new name made this script report
      // "every bucket carries no SSID" on an Android 12 phone, which is exactly
      // what the legitimate mobile/VPN case looks like, so it read as correct.
      // Measured 2026-09-04: an API 31 phone emits
      //   ident=[{type=1, subType=0, networkId="HomeWiFi_5G", metered=false, ...}]
      // against an API 36 phone's
      //   ident=[{transports={1}, wifiNetworkKey="...", ...}]
      // The VPN exclusion survives the rename: an API 31 VPN ident is type=17
      // and carries no networkId either, so "has an SSID" still filters it out.
      const key = /(?:wifiNetworkKey|networkId)="([^"]*)"/.exec(body);
      cur = {
        uid: Number(ident[2]),
        ssid: key ? key[1]! : null,
        metered: /metered=true/.test(body),
      };
      continue;
    }
    const st = /^\s*st=(\d+) rb=(\d+) rp=\d+ tb=(\d+) tp=\d+/.exec(line);
    if (!st || !cur) continue;
    buckets++;
    if (!cur.ssid) { skippedNoSsid++; continue; }

    const start = Number(st[1]) * 1000;
    const rx = Number(st[2]);
    const tx = Number(st[3]);
    if (rx === 0 && tx === 0) continue;

    const k = `${cur.uid}|${start}|${cur.ssid}|${cur.metered}`;
    const prev = merged.get(k);
    if (prev) { prev.rx += rx; prev.tx += tx; }
    else merged.set(k, { uid: cur.uid, start, ssid: cur.ssid, metered: cur.metered, rx, tx });
  }
  return { rows: [...merged.values()], skippedNoSsid, buckets };
}

/** Epoch ms -> the PHONE's local date and hour, matching the app's ingest. */
function localParts(epochMs: number, offsetMinutes: number): { date: string; hour: number } {
  const shifted = new Date(epochMs + offsetMinutes * 60_000);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

/* ------------------------------------------------------------------ */

const C = {
  head: (s: string) => `\n\x1b[36m=== ${s} ===\x1b[0m`,
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
};
const ok = (s: string) => console.log(`  \x1b[32m[OK]\x1b[0m   ${s}`);
const warn = (s: string) => console.log(`  \x1b[33m[WARN]\x1b[0m ${s}`);
const bad = (s: string) => console.log(`  \x1b[31m[FAIL]\x1b[0m ${s}`);
const GB = (b: number) => `${(b / 1073741824).toFixed(2)} GB`;

function dbPath(): string {
  const cfg = JSON.parse(
    readFileSync(join(process.cwd(), 'config', 'collector.json'), 'utf8'),
  ) as { databasePath: string };
  return cfg.databasePath;
}

/**
 * The device id the REPORTER APP generated.
 *
 * Read out of the app's own prefs with `run-as`, which works because the
 * sideloaded build is debuggable. Matching on brand and model instead would
 * break the moment there are two of the same handset -- and the whole point of
 * the id is that it survives a rename.
 */
function deviceIdFromApp(): string | null {
  const xml = adb(
    ['shell', 'run-as', 'com.naimul.datausage', 'cat',
      '/data/data/com.naimul.datausage/shared_prefs/data-usage.xml'],
    true,
  );
  if (xml.startsWith('__FAILED__')) return null;
  const m = /<string name="device_id">([^<]+)<\/string>/.exec(xml);
  return m ? m[1]!.trim() : null;
}

function main(): void {
  console.log(C.head('1. Device'));

  const attached = adb(['devices', '-l']).split(/\r?\n/).slice(1)
    .map((l) => l.trim()).filter(Boolean).filter((l) => !l.startsWith('*'));
  if (attached.length === 0) {
    bad('No device attached. Plug the phone in and enable USB debugging.');
    process.exit(1);
  }
  if (attached.some((l) => /unauthorized/.test(l))) {
    bad('Device attached but UNAUTHORIZED. Unlock it and accept the prompt.');
    process.exit(1);
  }
  if (attached.length > 1) {
    bad(`${attached.length} devices attached; this script expects exactly one.`);
    process.exit(1);
  }
  ok(`attached: ${attached[0]!.split(/\s+/)[0]}`);

  const deviceId = deviceIdFromApp();
  if (!deviceId) {
    bad('Could not read the reporter app\'s device id.');
    console.log('         Install and open Data Usage Reporter first: this data has to');
    console.log('         attach to the same device the app reports under, and its id is');
    console.log('         the only thing that survives a rename.');
    process.exit(1);
  }
  ok(`reporter device id ${deviceId}`);

  const offset = -new Date().getTimezoneOffset();
  console.log(C.dim(`  bucketing days at UTC${offset >= 0 ? '+' : ''}${offset / 60}h`));

  /* ---------------------------------------------------------------- */
  console.log(C.head('2. Capture'));

  // BOTH flags, and they are orthogonal -- this is the whole ballgame for how
  // far back the capture reaches. In AOSP's NetworkStatsService.dump():
  //   --full   -> "Complete history:"   (otherwise "History since boot:")
  //   detail   -> include uid and tag sections
  // `detail` alone therefore yields per-app rows that stop at the last REBOOT.
  // That went unnoticed because the first phone had ~58 days of uptime, so its
  // since-boot window looked exactly like the retention window. Measured on a
  // second phone (up 2d18h) 2026-09-04:
  //   detail          132 KB, oldest bucket 2026-09-01  <- uptime
  //   --full detail   371 KB, oldest bucket 2026-04-18  <- 139 days, the real store
  const dump = adb(['shell', 'dumpsys', 'netstats', '--full', 'detail']);
  ok(`${Math.round(dump.length / 1024)} KB of dumpsys output`);

  const { rows, skippedNoSsid, buckets } = parse(dump);
  const ssids = [...new Set(rows.map((r) => r.ssid))];
  const labelled = rows.reduce((a, r) => a + r.rx + r.tx, 0);

  ok(`${rows.length.toLocaleString()} SSID-labelled rows across ${ssids.length} networks`);
  console.log(C.dim(`  ${skippedNoSsid.toLocaleString()} of ${buckets.toLocaleString()} buckets carry no SSID`));
  console.log(C.dim('  (mobile data, and anything that crossed a VPN - neither is a loss here,'));
  console.log(C.dim('   because excluding VPN idents is also what avoids double-counting them)'));

  for (const s of ssids.sort()) {
    const b = rows.filter((r) => r.ssid === s).reduce((a, r) => a + r.rx + r.tx, 0);
    console.log(`    ${GB(b).padStart(10)}  ${s}`);
  }

  /* ---------------------------------------------------------------- */
  console.log(C.head('3. Store'));

  const db = openDatabase(dbPath());
  try {
    const known = db
      .prepare('SELECT 1 x FROM android_devices WHERE device_id = ?')
      .get(deviceId) as { x: number } | undefined;
    if (!known) {
      warn('this device has never uploaded from the app; storing anyway');
      console.log(C.dim('  The dashboard groups by device_id, so the pages will show it once'));
      console.log(C.dim('  the app has synced at least once.'));
    }

    const before = Number(
      (db.prepare('SELECT COUNT(*) c FROM android_ssid_usage WHERE device_id = ?')
        .get(deviceId) as { c: number }).c,
    );

    // MAX(), not assignment: a bucket read mid-window is a partial figure, and
    // a later capture must be able to complete it without an earlier one being
    // able to shrink it. Same rule as the app's ingest.
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

    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      for (const r of rows) {
        const { date, hour } = localParts(r.start, offset);
        upsert.run(
          deviceId, r.uid, new Date(r.start).toISOString(), date, hour,
          r.ssid, r.metered ? 1 : 0, r.rx, r.tx, now,
        );
      }
      // Keyed PER DEVICE. It was one global 'android_ssid_last_collect', so
      // capturing one phone made every other phone's card claim that date --
      // and since this script refuses to run with two phones attached, no two
      // captures ever share a run. getSsidBreakdown() reads this key.
      db.prepare(
        `INSERT INTO meta(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(`android_ssid_last_collect:${deviceId}`, now);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const after = Number(
      (db.prepare('SELECT COUNT(*) c FROM android_ssid_usage WHERE device_id = ?')
        .get(deviceId) as { c: number }).c,
    );
    ok(`${(after - before).toLocaleString()} new rows, ${after.toLocaleString()} stored in total`);
    ok(`${GB(labelled)} of SSID-attributed traffic in this capture`);

    const span = db
      .prepare(
        `SELECT MIN(local_date) a, MAX(local_date) b, COUNT(DISTINCT local_date) d
         FROM android_ssid_usage WHERE device_id = ?`,
      )
      .get(deviceId) as { a: string | null; b: string | null; d: number };
    if (span.a) ok(`covering ${span.a} -> ${span.b} (${span.d} days)`);
  } finally {
    db.close();
  }

  console.log(C.head('Done'));
  console.log('  Android keeps ~90 days, so monthly is enough. Re-running is safe:');
  console.log('  the write takes MAX(), so a second pass over the same window changes');
  console.log('  nothing except a bucket that was still filling last time.');
}

main();
