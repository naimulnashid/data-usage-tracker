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
import { checkRename, type RenameError } from './rename-rule';

/** The `device` value for the laptop. There is only ever one. */
export const WINDOWS_RENAMES = 'windows';

export { MAX_NAME_LENGTH, cleanName, type RenameError } from './rename-rule';

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
 * Validate and store (or clear) one rename. The rule is `checkRename`'s;
 * this adds the write.
 */
export function saveRename(opts: {
  device: string;
  key: string;
  name: unknown;
  current: Map<string, { name: string; base: string }>;
  base: string;
}): { ok: true; name: string } | { ok: false; error: RenameError } {
  const { device, key, base } = opts;
  const verdict = checkRename(opts);
  if (!verdict.ok) return verdict;
  const { name } = verdict;

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
