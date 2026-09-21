/**
 * Read-only report over the collected database.
 *
 *   npm run stats -- [--db <path>] [--days 30] [--profile <l2ProfileId>]
 *
 * Exists to be diffed against Settings -> Data usage. Note that Windows scopes
 * its page to ONE network profile, so an unscoped total here will legitimately
 * read higher; pass --profile to compare like for like.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { resolveApp } from '../src/lib/app-name.js';
import type { AppKind } from '../src/lib/srum.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const gb = (n: number) => (n / 1024 ** 3).toFixed(2).padStart(10);

function main(): void {
  const cfg = JSON.parse(
    readFileSync(join(ROOT, 'config', 'collector.json'), 'utf8'),
  ) as { databasePath: string; splitApp?: string | null };

  const dbPath = arg('db') ?? cfg.databasePath;
  const days = Number(arg('days') ?? 30);
  const profile = arg('profile');

  const db = new DatabaseSync(dbPath, { readOnly: true });

  const since = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const scope = profile ? ' AND l2_profile_id = ?' : '';
  const scopeArgs = profile ? [profile] : [];

  console.log(`db      : ${dbPath}`);
  console.log(`window  : last ${days} days (local_date >= ${since})`);
  console.log(`profile : ${profile ?? 'ALL (Windows scopes to one -- expect a higher total)'}\n`);

  // Headline total comes from the aggregate rows, never from summing apps.
  const total = db
    .prepare(
      `SELECT COALESCE(SUM(bytes_sent),0) s, COALESCE(SUM(bytes_received),0) r
       FROM usage_records WHERE is_aggregate = 1 AND local_date >= ?${scope}`,
    )
    .get(since, ...scopeArgs) as { s: number; r: number };

  const perApp = db
    .prepare(
      `SELECT COALESCE(SUM(bytes_sent),0) s, COALESCE(SUM(bytes_received),0) r
       FROM usage_records WHERE is_aggregate = 0 AND local_date >= ?${scope}`,
    )
    .get(since, ...scopeArgs) as { s: number; r: number };

  console.log('  ' + '-'.repeat(52));
  console.log(`   Sent           ${gb(total.s)} GB`);
  console.log(`   Received       ${gb(total.r)} GB`);
  console.log(`   TOTAL          ${gb(total.s + total.r)} GB   <- compare to Windows`);
  console.log('  ' + '-'.repeat(52));
  console.log(`   named apps     ${gb(perApp.s + perApp.r)} GB`);
  console.log(
    `   unattributed   ${gb(total.s + total.r - perApp.s - perApp.r)} GB`,
  );
  console.log('  ' + '-'.repeat(52) + '\n');

  const rows = db
    .prepare(
      `SELECT app_identity, app_kind,
              SUM(bytes_sent) s, SUM(bytes_received) r, COUNT(*) n
       FROM usage_records
       WHERE is_aggregate = 0 AND local_date >= ?${scope}
       GROUP BY app_identity, app_kind`,
    )
    .all(since, ...scopeArgs) as {
    app_identity: string;
    app_kind: string;
    s: number;
    r: number;
    n: number;
  }[];

  // Group by resolved app, so versioned paths and AppX versions collapse into
  // one entry the way Windows presents them.
  const grouped = new Map<string, { name: string; bytes: number; rows: number }>();
  for (const row of rows) {
    const { groupKey, displayName } = resolveApp(row.app_identity, row.app_kind as AppKind);
    const cur = grouped.get(groupKey) ?? { name: displayName, bytes: 0, rows: 0 };
    cur.bytes += row.s + row.r;
    cur.rows += row.n;
    grouped.set(groupKey, cur);
  }

  const sorted = [...grouped.values()].sort((a, b) => b.bytes - a.bytes);
  const grand = sorted.reduce((acc, a) => acc + a.bytes, 0) || 1;

  console.log('  Top apps:');
  console.log(`  ${'app'.padEnd(32)}${'GB'.padStart(10)}${'%'.padStart(8)}${'rows'.padStart(8)}`);
  console.log('  ' + '-'.repeat(58));
  for (const a of sorted.slice(0, 20)) {
    console.log(
      `  ${a.name.slice(0, 31).padEnd(32)}${gb(a.bytes)}` +
        `${((a.bytes / grand) * 100).toFixed(1).padStart(8)}${String(a.rows).padStart(8)}`,
    );
  }

  // The configured app vs everything else -- the Overview's split card, which
  // appears only when `splitApp` is set and that app moved something.
  const splitApp = typeof cfg.splitApp === 'string' && cfg.splitApp.trim() ? cfg.splitApp.trim() : null;
  const focus = splitApp ? sorted.find((a) => a.name === splitApp)?.bytes ?? 0 : 0;
  if (splitApp && focus > 0) {
    console.log('\n  ' + '-'.repeat(52));
    console.log(`   ${splitApp.padEnd(15).slice(0, 15)}${gb(focus)} GB  (${((focus / grand) * 100).toFixed(1)}%)`);
    console.log(`   everything else${gb(grand - focus)} GB  (${(((grand - focus) / grand) * 100).toFixed(1)}%)`);
    console.log('  ' + '-'.repeat(52));
  }

  const profiles = db
    .prepare(
      `SELECT l2_profile_id p, SUM(bytes_sent + bytes_received) b, COUNT(*) n
       FROM usage_records WHERE is_aggregate = 0 AND local_date >= ?
       GROUP BY l2_profile_id ORDER BY b DESC`,
    )
    .all(since) as { p: string; b: number; n: number }[];

  if (profiles.length > 1) {
    console.log('\n  Network profiles (why an unscoped total exceeds Windows):');
    for (const p of profiles.slice(0, 6)) {
      console.log(`    ${(p.p || '(none)').padEnd(14)}${gb(p.b)} GB   ${p.n} rows`);
    }
  }

  const last = db
    .prepare(
      `SELECT started_at, status, rows_inserted, rows_skipped, backup_status, duration_ms
       FROM sync_log ORDER BY id DESC LIMIT 5`,
    )
    .all() as Record<string, unknown>[];

  if (last.length > 0) {
    console.log('\n  Recent collector runs:');
    for (const r of last) {
      console.log(
        `    ${String(r['started_at']).slice(0, 19)}  ${String(r['status']).padEnd(8)}` +
          ` +${r['rows_inserted']} new, ${r['rows_skipped']} dup` +
          `  backup=${r['backup_status']}  ${r['duration_ms']}ms`,
      );
    }
  }

  db.close();
}

main();
