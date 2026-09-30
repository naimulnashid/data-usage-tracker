import 'server-only';

/**
 * Chart colours the user chose in the dashboard, overriding the assigned ones.
 *
 * The same shape as renames (lib/app-renames.ts), for the same reasons: stored
 * in the database because it is on D:, backed up and survives the reset, and
 * keyed by what already identifies an app on each side --
 *
 *   Windows  device 'windows',     app_key = the FAMILY's groupKey
 *   Android  device = device_id,   app_key = the uid, as text
 *
 * An override is applied by the two colour-map builders, AFTER brand and
 * palette assignment and after a rename has carried its original's colour
 * across. So it wins over everything, under whatever name the app shows.
 *
 * Two apps may share a colour: unlike a name, a colour keys nothing. That is
 * the user's call to make.
 *
 * Readers tolerate the table being absent, exactly as `readRenames` does:
 * `SCHEMA_SQL` creates it on the first write path after this shipped.
 */

import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db';
import { databasePath } from './android-ingest';
import { cleanColor } from './app-colors';

/** app_key -> #rrggbb, for one device. Empty when none or no table yet. */
export function readColorOverrides(db: DatabaseSync, device: string): Map<string, string> {
  try {
    const rows = db
      .prepare('SELECT app_key k, color c FROM app_colors WHERE device = ?')
      .all(device) as { k: string; c: string }[];
    // Re-validated on the way out: a hand-edited row must not become an
    // arbitrary string in a style attribute.
    return new Map(rows.flatMap((r) => {
      const c = cleanColor(r.c);
      return c ? [[r.k, c] as [string, string]] : [];
    }));
  } catch {
    return new Map();
  }
}

export type ColorError = 'unknown-app' | 'bad-color';

/**
 * Validate and store (or clear) one colour. An empty string clears it, which
 * returns the app to its brand or palette colour.
 */
export function saveColorOverride(opts: {
  device: string;
  key: string;
  color: unknown;
  known: Set<string>;
}): { ok: true; color: string | null } | { ok: false; error: ColorError } {
  const { device, key, known } = opts;
  if (!known.has(key)) return { ok: false, error: 'unknown-app' };

  const reset = typeof opts.color === 'string' && opts.color.trim() === '';
  const color = reset ? null : cleanColor(opts.color);
  if (!reset && color === null) return { ok: false, error: 'bad-color' };

  const db = openDatabase(databasePath());
  try {
    if (color === null) {
      db.prepare('DELETE FROM app_colors WHERE device = ? AND app_key = ?').run(device, key);
    } else {
      db.prepare(
        `INSERT INTO app_colors (device, app_key, color, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (device, app_key) DO UPDATE SET color = excluded.color, updated_at = excluded.updated_at`,
      ).run(device, key, color, new Date().toISOString());
    }
  } finally {
    db.close();
  }
  return { ok: true, color };
}
