/**
 * Database access.
 *
 * Uses node:sqlite -- Node's BUILT-IN SQLite (22.5+), not better-sqlite3.
 * Deliberate: the collector must still run after a Windows reset and a clean
 * `npm install` years from now, and a native module with a node-gyp build step
 * is the most likely thing to break in that scenario. node:sqlite also gives us
 * backup(), which is how the Google Drive copy stays internally consistent.
 */

import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
// Extensionless, not './schema.js'. This module is now reached from a Next
// route (the Android ingest) as well as from the tsx scripts, and webpack
// cannot resolve the .js specifier against a .ts file. tsconfig uses
// moduleResolution 'bundler', so extensionless works for tsc and tsx too.
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export interface CollectorConfig {
  databasePath: string;
  backupPath: string;
  scratchDir: string;
  srumPath: string;
  srumECmdDir: string;
  keepScratch: boolean;
  backupEnabled: boolean;
}

/**
 * Guard the one rule the whole project exists to enforce.
 *
 * A database under C:\ is destroyed by the Windows reset this tool is meant to
 * survive. Failing loudly at startup beats discovering it after a reset.
 */
export function assertNotOnSystemDrive(dbPath: string): void {
  const abs = resolve(dbPath);
  const systemDrive = (process.env['SystemDrive'] ?? 'C:').toUpperCase();
  if (abs.toUpperCase().startsWith(systemDrive + '\\')) {
    throw new Error(
      `Refusing to use a database on the system drive: ${abs}\n` +
        `It would be destroyed by a Windows reset, which is the exact failure ` +
        `this project exists to prevent.\n` +
        `Point databasePath in config/collector.json at another drive.`,
    );
  }
}

export interface OpenOptions {
  /**
   * Skip the system-drive guard.
   *
   * ONLY for the self-test, which uses a throwaway database in TEMP. The
   * collector must never set this: a real database on C:\ silently defeats the
   * entire point of the project, and the failure is invisible until a reset has
   * already destroyed the history.
   */
  allowSystemDrive?: boolean;
}

export function openDatabase(dbPath: string, opts: OpenOptions = {}): DatabaseSync {
  if (opts.allowSystemDrive) {
    console.warn('  ! system-drive guard bypassed (test mode)');
  } else {
    assertNotOnSystemDrive(dbPath);
  }

  const dir = dirname(resolve(dbPath));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);

  const stmt = db.prepare(
    `INSERT INTO meta(key, value) VALUES('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  stmt.run(String(SCHEMA_VERSION));

  return db;
}

/**
 * Fold the write-ahead log back into the main database file and truncate it.
 *
 * Matters because the live database sits inside a Google-Drive-synced folder.
 * In WAL mode a database is three files (.db, .db-wal, .db-shm) that must be
 * mutually consistent to restore; recent writes live in the -wal until a
 * checkpoint. Without this, Drive can upload a .db missing its latest rows
 * alongside a -wal it captured at a different instant.
 *
 * Checkpointing right after ingest leaves the main file complete and the
 * sidecars empty for the ~24h the collector is idle, which is when Drive
 * actually does its uploading. It does not make the synced live file a
 * trustworthy restore source -- that is what backupPath is for -- but it
 * shrinks the window where it is wrong from constant to momentary.
 */
export function checkpointWal(db: DatabaseSync): void {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // Non-fatal: a failed checkpoint costs tidiness, not data.
  }
}

/**
 * Write a consistent copy to the backup location.
 *
 * Uses SQLite's backup API rather than copying the file: a plain copy of an
 * open database can be torn mid-write, and in WAL mode would miss the WAL
 * entirely. Returns a status string for sync_log instead of throwing -- a
 * failed backup must not discard a successful collection.
 */
export async function backupDatabase(
  db: DatabaseSync,
  backupPath: string,
): Promise<string> {
  try {
    const dir = dirname(resolve(backupPath));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await backup(db, backupPath);
    return 'ok';
  } catch (err) {
    return `failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function startSyncRun(db: DatabaseSync): number {
  const r = db
    .prepare(`INSERT INTO sync_log(started_at, status) VALUES(?, 'running')`)
    .run(new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export interface SyncResult {
  status: 'success' | 'failed';
  rowsRead: number;
  rowsInserted: number;
  rowsSkipped: number;
  srumOldestUtc: string | null;
  srumNewestUtc: string | null;
  backupStatus: string | null;
  durationMs: number;
  error: string | null;
}

export function finishSyncRun(db: DatabaseSync, id: number, r: SyncResult): void {
  db.prepare(
    `UPDATE sync_log SET
       finished_at = ?, status = ?, rows_read = ?, rows_inserted = ?,
       rows_skipped = ?, srum_oldest_utc = ?, srum_newest_utc = ?,
       backup_status = ?, duration_ms = ?, error = ?
     WHERE id = ?`,
  ).run(
    new Date().toISOString(),
    r.status,
    r.rowsRead,
    r.rowsInserted,
    r.rowsSkipped,
    r.srumOldestUtc,
    r.srumNewestUtc,
    r.backupStatus,
    r.durationMs,
    r.error,
    id,
  );
}
