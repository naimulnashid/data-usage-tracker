import 'server-only';

/**
 * Two choices the user makes about apps on the By App page: hiding one, and
 * merging one into another.
 *
 * Stored in the database beside renames and colours (schema 8), keyed the
 * same way -- device 'windows' + the family groupKey, or a phone's device_id
 * + the uid -- and for the same reason: the database survives the reset and
 * is backed up, and these are facts about how the history is read.
 *
 * **Hiding is a view choice.** A hidden app leaves the By App list, grid and
 * Top 10, and nothing else: the headline totals, the charts and every other
 * page still count it, or a hidden app would quietly make the numbers stop
 * adding up. "Show hidden" on the page lists them again, to bring one back.
 *
 * **Merging is a naming choice**, like a rename one level up. The merged app
 * is read as part of its target everywhere -- totals, charts, colours, the
 * detail page -- exactly as the built-in families merge Claude Code and
 * Claude Desktop into Claude. The target's Merged apps card lists what was
 * folded in and undoes it. No bytes move; deleting the row restores the app.
 *
 * One level only: a target is never itself merged. Merging into an app that
 * is already merged stores the merge against ITS target, and merging an app
 * that others were merged into carries them along, so a lookup is one step
 * and a chain can never loop.
 *
 * Readers open the database read-only and tolerate the tables being absent,
 * as with renames: `SCHEMA_SQL` creates them on the first write path.
 */

import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db';
import { databasePath } from './android-ingest';

/** app_key -> the key it is merged into, for one device. */
export function readMerges(db: DatabaseSync, device: string): Map<string, string> {
  try {
    const rows = db
      .prepare('SELECT app_key k, into_key t FROM app_merges WHERE device = ?')
      .all(device) as { k: string; t: string }[];
    return new Map(rows.map((r) => [r.k, r.t]));
  } catch {
    return new Map();
  }
}

/** The app keys hidden from the By App page, for one device. */
export function readHidden(db: DatabaseSync, device: string): Set<string> {
  try {
    const rows = db
      .prepare('SELECT app_key k FROM app_hidden WHERE device = ?')
      .all(device) as { k: string }[];
    return new Set(rows.map((r) => r.k));
  } catch {
    return new Set();
  }
}

export type PrefError = 'unknown-app' | 'same-app';

function write<T>(fn: (db: DatabaseSync) => T): T {
  // Through openDatabase, like a rename: the system-drive guard, and the
  // schema that creates these tables.
  const db = openDatabase(databasePath());
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function setHidden(device: string, key: string, hidden: boolean): void {
  write((db) => {
    if (hidden) {
      db.prepare(
        `INSERT INTO app_hidden (device, app_key, hidden_at) VALUES (?, ?, ?)
         ON CONFLICT (device, app_key) DO NOTHING`,
      ).run(device, key, new Date().toISOString());
    } else {
      db.prepare('DELETE FROM app_hidden WHERE device = ? AND app_key = ?').run(device, key);
    }
  });
}

/**
 * Merge `key` into `into`, or undo `key`'s merge when `into` is null.
 * `known` is every app key on the device, merged ones included.
 */
export function setMerge(
  device: string, key: string, into: string | null, known: Set<string>,
): { ok: true } | { ok: false; error: PrefError } {
  if (!known.has(key)) return { ok: false, error: 'unknown-app' };
  return write((db) => {
    if (into === null) {
      db.prepare('DELETE FROM app_merges WHERE device = ? AND app_key = ?').run(device, key);
      return { ok: true } as const;
    }
    if (!known.has(into)) return { ok: false, error: 'unknown-app' } as const;
    // One level: follow the target to its own target first.
    const target = readMerges(db, device).get(into) ?? into;
    if (target === key) return { ok: false, error: 'same-app' } as const;
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      // Whatever was merged into `key` follows it to the new target.
      db.prepare('UPDATE app_merges SET into_key = ?, updated_at = ? WHERE device = ? AND into_key = ?')
        .run(target, now, device, key);
      db.prepare(
        `INSERT INTO app_merges (device, app_key, into_key, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (device, app_key) DO UPDATE SET into_key = excluded.into_key, updated_at = excluded.updated_at`,
      ).run(device, key, target, now);
      // A merged app is not on the list to be hidden from.
      db.prepare('DELETE FROM app_hidden WHERE device = ? AND app_key = ?').run(device, key);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { ok: true } as const;
  });
}
