/**
 * Ingest a SrumECmd NetworkUsages CSV into the persistent database.
 *
 *   npm run ingest -- --csv <dir-or-file> [--db <path>] [--backup-to <path>]
 *                     [--dry-run] [--no-backup]
 *
 * Idempotent by construction: re-running over overlapping data inserts zero
 * rows, because the UNIQUE dedup index makes repeat rows byte-identical and
 * INSERT OR IGNORE skips them. That property is what lets the collector run on
 * a schedule without tracking a watermark.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

import { parseCsvObjects, requireColumns } from '../src/lib/csv.js';
import { mapRow, REQUIRED_COLUMNS, type UsageRow } from '../src/lib/srum.js';
import {
  openDatabase,
  backupDatabase,
  checkpointWal,
  startSyncRun,
  finishSyncRun,
  type CollectorConfig,
  type SyncResult,
} from '../src/lib/db.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function loadConfig(): CollectorConfig {
  const p = join(ROOT, 'config', 'collector.json');
  const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  return {
    databasePath: String(raw['databasePath']),
    backupPath: String(raw['backupPath']),
    scratchDir: String(raw['scratchDir']),
    srumPath: String(raw['srumPath']),
    srumECmdDir: String(raw['srumECmdDir']),
    keepScratch: raw['keepScratch'] === true,
    backupEnabled: raw['backupEnabled'] !== false,
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

/** Accept a directory or a direct file path; pick the newest match in a dir. */
function findNetworkUsagesCsv(target: string): string {
  const abs = resolve(target);
  if (!existsSync(abs)) throw new Error(`Path does not exist: ${abs}`);

  if (statSync(abs).isFile()) return abs;

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.isFile() && /NetworkUsages.*\.csv$/i.test(e.name) ? [p] : [];
    });

  const hits = walk(abs);
  if (hits.length === 0) {
    throw new Error(
      `No *NetworkUsages*.csv found under ${abs}\n` +
        `Did SrumECmd run? It writes one CSV per SRUM table.`,
    );
  }
  return hits.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
}

function insertRows(db: DatabaseSync, rows: UsageRow[]): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO usage_records (
       timestamp_utc, local_date, local_hour, app_id, is_aggregate,
       app_identity, app_kind, user_id, sid, interface_luid, interface_type,
       l2_profile_id, profile_name, bytes_sent, bytes_received, ingested_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  const ingestedAt = new Date().toISOString();
  let inserted = 0;

  // One transaction for the whole batch. Without it, ~18k individual commits
  // turn a sub-second ingest into a multi-minute one.
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const res = stmt.run(
        r.timestampUtc,
        r.localDate,
        r.localHour,
        r.appId,
        r.isAggregate ? 1 : 0,
        r.appIdentity,
        r.appKind,
        r.userId,
        r.sid,
        r.interfaceLuid,
        r.interfaceType,
        r.l2ProfileId,
        r.profileName,
        r.bytesSent,
        r.bytesReceived,
        ingestedAt,
      );
      if (res.changes > 0) inserted++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return inserted;
}

/**
 * Record what network the machine is on, and resolve older observations.
 *
 * Two steps, deliberately separate.
 *
 * **Recording** is immediate: the collector wrote down a name and a timestamp.
 *
 * **Resolution is deferred**, and that is the whole point. SRUM writes hourly,
 * and the VSS snapshot is additionally missing the most recent uncommitted
 * hour, so its newest row is routinely more than an hour old. The first version
 * paired "the network I am on now" with "the profile owning the newest row" and
 * so attributed across a network change -- switching SSID and syncing renamed a
 * profile after a network it had never carried. Observed on real data on
 * 2026-08-21, which is why this is now two steps.
 *
 * An observation resolves only once the hour it falls in is present in
 * `usage_records`, and only if exactly ONE profile has rows in that hour. An
 * hour spanning a network change carries two, and there is no honest way to say
 * which the observation belonged to -- so it is marked ambiguous rather than
 * guessed.
 */
function recordNetworkObservation(db: DatabaseSync, scratchDir: string): void {
  const file = join(scratchDir, 'network.json');
  if (!existsSync(file)) return;

  try {
    // Strip the BOM. PowerShell's `Set-Content -Encoding utf8` writes one under
    // Windows PowerShell 5.1, and JSON.parse throws on it -- which, swallowed
    // by a catch, looked exactly like "no network was recorded".
    const raw = JSON.parse(
      readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
    ) as Record<string, unknown>;

    const rawConns = raw['connections'];
    const conns = (Array.isArray(rawConns) ? rawConns : rawConns ? [rawConns] : []) as {
      name?: string;
      interface?: string;
    }[];

    // Two active connections (Wi-Fi plus a dock, say) make the pairing
    // ambiguous. Recording a guess is worse than recording nothing.
    if (conns.length !== 1) return;

    const conn = conns[0]!;
    if (!conn.name) return;

    db.prepare(
      `INSERT OR IGNORE INTO network_observations (observed_at, name, interface)
       VALUES (?, ?, ?)`,
    ).run(
      String(raw['observedAt'] ?? new Date().toISOString()),
      conn.name,
      conn.interface ?? '',
    );
  } catch (err) {
    console.log(
      `network : could not read ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function resolveNetworkObservations(db: DatabaseSync): string[] {
  const pending = db
    .prepare(
      `SELECT observed_at, name, interface FROM network_observations
       WHERE resolved_to IS NULL`,
    )
    .all() as { observed_at: string; name: string; interface: string }[];

  const notes: string[] = [];

  for (const obs of pending) {
    // SRUM timestamps are hourly, so compare on the hour the observation fell in.
    const hour = obs.observed_at.slice(0, 13);

    const profiles = db
      .prepare(
        `SELECT DISTINCT l2_profile_id p FROM usage_records
         WHERE substr(timestamp_utc, 1, 13) = ? AND l2_profile_id NOT IN ('', '0')`,
      )
      .all(hour) as { p: string }[];

    // Hour not written yet: leave pending. It resolves on a later run.
    if (profiles.length === 0) continue;

    if (profiles.length > 1) {
      db.prepare(
        `UPDATE network_observations SET resolved_to = 'ambiguous' WHERE observed_at = ?`,
      ).run(obs.observed_at);
      notes.push(`${obs.name}: hour ${hour}Z carried ${profiles.length} profiles, not attributed`);
      continue;
    }

    const profile = profiles[0]!.p;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO network_names (l2_profile_id, name, interface, votes, first_seen, last_seen)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(l2_profile_id, name) DO UPDATE SET
         votes = network_names.votes + 1,
         last_seen = excluded.last_seen`,
    ).run(profile, obs.name, obs.interface, now, now);

    db.prepare(
      `UPDATE network_observations SET resolved_to = ? WHERE observed_at = ?`,
    ).run(profile, obs.observed_at);

    notes.push(`${obs.name} -> profile ${profile}`);
  }

  return notes;
}

/**
 * Record a run that failed before ingest could start.
 *
 * The collector calls this when the VSS snapshot or SrumECmd step dies. Without
 * it those failures leave no trace in the database, and the Sync Status page
 * would show the last *successful* run as if nothing were wrong -- which is
 * exactly the situation that silently loses history to a reset.
 */
function recordFailure(dbPath: string, message: string): void {
  const db = openDatabase(dbPath, {
    allowSystemDrive: hasFlag('allow-system-drive'),
  });
  const id = startSyncRun(db);
  finishSyncRun(db, id, {
    status: 'failed',
    rowsRead: 0,
    rowsInserted: 0,
    rowsSkipped: 0,
    srumOldestUtc: null,
    srumNewestUtc: null,
    backupStatus: null,
    durationMs: 0,
    error: message,
  });
  db.close();
  console.log(`recorded failed run: ${message}`);
}

async function main(): Promise<void> {
  const started = Date.now();
  const cfg = loadConfig();

  const csvTarget = arg('csv') ?? cfg.scratchDir;
  const dbPath = arg('db') ?? cfg.databasePath;
  // Overridable so the reset drill can exercise the real backup path without
  // writing over the live one.
  const backupTo = arg('backup-to') ?? cfg.backupPath;
  const dryRun = hasFlag('dry-run');
  const doBackup = cfg.backupEnabled && !hasFlag('no-backup') && !dryRun;

  const failure = arg('record-failure');
  if (failure !== undefined) {
    recordFailure(dbPath, failure);
    return;
  }

  console.log(`csv    : ${csvTarget}`);
  console.log(`db     : ${dbPath}${dryRun ? '  (dry run, nothing written)' : ''}`);

  const csvPath = findNetworkUsagesCsv(csvTarget);
  console.log(`parsing: ${csvPath}`);

  const records = parseCsvObjects(readFileSync(csvPath, 'utf8'));
  requireColumns(records, REQUIRED_COLUMNS);

  const rows: UsageRow[] = [];
  let badTimestamps = 0;
  for (const rec of records) {
    const row = mapRow(rec);
    if (row) rows.push(row);
    else badTimestamps++;
  }

  console.log(`rows   : ${records.length} read, ${rows.length} mapped` +
    (badTimestamps ? `, ${badTimestamps} skipped (bad timestamp)` : ''));

  if (rows.length === 0) throw new Error('No usable rows in CSV.');

  const times = rows.map((r) => r.timestampUtc).sort();
  const oldest = times[0]!;
  const newest = times[times.length - 1]!;
  console.log(`window : ${oldest} -> ${newest}  (UTC)`);

  const agg = rows.filter((r) => r.isAggregate).length;
  console.log(`        ${agg} aggregate rows (AppId 1), ${rows.length - agg} per-app`);

  if (dryRun) {
    console.log('\ndry run complete -- nothing written.');
    return;
  }

  const db = openDatabase(dbPath, {
    allowSystemDrive: hasFlag('allow-system-drive'),
  });
  const runId = startSyncRun(db);

  const result: SyncResult = {
    status: 'failed',
    rowsRead: records.length,
    rowsInserted: 0,
    rowsSkipped: 0,
    srumOldestUtc: oldest,
    srumNewestUtc: newest,
    backupStatus: null,
    durationMs: 0,
    error: null,
  };

  let logged = false;

  try {
    const inserted = insertRows(db, rows);
    result.rowsInserted = inserted;
    result.rowsSkipped = rows.length - inserted;
    result.status = 'success';

    console.log(`\ninserted: ${inserted}`);
    console.log(`skipped : ${result.rowsSkipped} (already present)`);

    // Must run AFTER the rows land: the attribution looks for the profile id
    // owning the newest row, which this run may just have added.
    //
    // `--csv` points at the CSV subdirectory, but the collector writes
    // network.json to the scratch root beside it.
    const scratchRoot = /[\\/]csv[\\/]?$/i.test(csvTarget) ? join(csvTarget, '..') : csvTarget;
    recordNetworkObservation(db, scratchRoot);
    for (const note of resolveNetworkObservations(db)) console.log(`network : ${note}`);

    // Finalise the sync_log row BEFORE taking the backup.
    //
    // The backup used to be taken while this run's row still said 'running',
    // because the row was only completed in the finally block. Every backup
    // therefore contained a permanent record of itself frozen mid-flight, and a
    // restored database showed a phantom stuck run whose timestamp was newer
    // than the newest 'success' -- so the Sync page reported the last
    // successful collection as older than it really was, on the one occasion
    // that page matters most. Caught by restoring for real in Phase 4.
    result.durationMs = Date.now() - started;
    result.backupStatus = doBackup ? 'pending' : 'skipped';
    finishSyncRun(db, runId, result);
    logged = true;

    // Checkpoint after the log write so the WAL is empty and the live .db on
    // disk is complete -- it sits in a Drive-synced folder. See checkpointWal().
    checkpointWal(db);

    if (doBackup) {
      process.stdout.write(`backup  : ${backupTo} ... `);
      result.backupStatus = await backupDatabase(db, backupTo);
      console.log(result.backupStatus);
      // Record the outcome. This write lands after the snapshot was taken, so
      // the backup's own copy of this row reads 'pending' -- which is accurate:
      // at that instant the backup had not finished.
      result.durationMs = Date.now() - started;
      finishSyncRun(db, runId, result);
    }

    const total = db
      .prepare('SELECT COUNT(*) AS c FROM usage_records')
      .get() as { c: number };
    console.log(`total   : ${total.c} rows in database`);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.status = 'failed';
    throw err;
  } finally {
    if (!logged) {
      result.durationMs = Date.now() - started;
      finishSyncRun(db, runId, result);
    }
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(`\nERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
