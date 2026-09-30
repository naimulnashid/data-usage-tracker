import 'server-only';

/**
 * Display names the user chose in the dashboard, overriding the resolved ones.
 *
 * **Stored in the database, not in config or code**, because the database is
 * the one thing guaranteed to survive a reset: it lives on D:, it is backed
 * up with the rest of the history, and a rename is a fact about that history.
 *
 * Keyed by what already identifies an app on each side, so a rename never
 * moves any bytes:
 *
 *   Windows  device 'windows',     app_key = the FAMILY's groupKey
 *   Android  device = device_id,   app_key = the uid, as text
 *
 * On Windows it renames the family, never a member: the family is what every
 * page groups, charts and links on, and the detail page's "Merged apps" card
 * keeps showing members as they are.
 *
 * **A family's display name keys its colour and its logo**, and two rules keep
 * that from going wrong:
 *
 * - A new name may not be one another app on the same device already shows,
 *   or the two would silently share a colour and a logo, as Windows
 *   PowerShell and PowerShell 7 once did. The API route enforces it.
 * - A renamed app keeps the colour and the logo of its ORIGINAL name, unless a
 *   logo file matches the new name. Renaming "Microsoft Edge" to "Edge" should
 *   not turn the Edge mark into a colour swatch. See `getAppIconMap`'s
 *   `aliases` and the two colour maps.
 *
 * Readers open the database read-only and must tolerate the table being
 * absent: it is created by `SCHEMA_SQL`, which runs on the first write path to
 * touch the file after this shipped (a collector run, a phone sync, or a
 * rename), and a page must not fail in the gap.
 */

import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db';
import { databasePath } from './android-ingest';

/** The `device` value for the laptop. There is only ever one. */
export const WINDOWS_RENAMES = 'windows';

/** Longest name accepted. Long enough for a real product name, short enough for a legend. */
export const MAX_NAME_LENGTH = 60;

/**
 * Names `assignColors` and `colorOf` treat specially. Taking one would hand an
 * app the grey reserved for "everything else".
 */
const RESERVED = new Set(['other', 'unattributed']);

/** app_key -> chosen name, for one device. Empty when none or no table yet. */
export function readRenames(db: DatabaseSync, device: string): Map<string, string> {
  try {
    const rows = db
      .prepare('SELECT app_key k, name n FROM app_renames WHERE device = ?')
      .all(device) as { k: string; n: string }[];
    return new Map(rows.map((r) => [r.k, r.n]));
  } catch {
    // "no such table" until the first write path runs the new schema.
    return new Map();
  }
}

/**
 * Tidy a submitted name: trim, collapse inner whitespace, drop control
 * characters. Returns null for a name that is unusable after that.
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

export type RenameError = 'unknown-app' | 'bad-name' | 'reserved' | 'taken';

/**
 * Validate and store (or clear) one rename.
 *
 * `current` is every app on the device as it is displayed right now, renames
 * included, keyed like `app_key`; `base` is what this app would be called with
 * no rename. Passing an empty name, or the base name itself, clears the
 * override rather than storing a no-op.
 */
export function saveRename(opts: {
  device: string;
  key: string;
  name: unknown;
  current: Map<string, string>;
  base: string;
}): { ok: true; name: string } | { ok: false; error: RenameError } {
  const { device, key, current, base } = opts;
  if (!current.has(key)) return { ok: false, error: 'unknown-app' };

  const reset = typeof opts.name === 'string' && opts.name.trim() === '';
  const name = reset ? base : cleanName(opts.name);
  if (name === null) return { ok: false, error: 'bad-name' };

  if (!reset && name !== base) {
    const lower = name.toLowerCase();
    if (RESERVED.has(lower)) return { ok: false, error: 'reserved' };
    for (const [k, shown] of current) {
      if (k !== key && shown.toLowerCase() === lower) return { ok: false, error: 'taken' };
    }
  }

  // Through openDatabase, like the phone's ingest: the system-drive guard and
  // the schema -- which is what creates app_renames -- apply here too.
  const db = openDatabase(databasePath());
  try {
    if (name === base) {
      db.prepare('DELETE FROM app_renames WHERE device = ? AND app_key = ?').run(device, key);
    } else {
      db.prepare(
        `INSERT INTO app_renames (device, app_key, name, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (device, app_key) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      ).run(device, key, name, new Date().toISOString());
    }
  } finally {
    db.close();
  }
  return { ok: true, name };
}
