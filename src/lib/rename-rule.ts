/**
 * What an app may be renamed to. Pure, so the self-test can drive it; the
 * write is `saveRename` in app-renames.ts, which is server-only.
 */

/** Longest name accepted. Long enough for a real product name, short enough for a legend. */
export const MAX_NAME_LENGTH = 60;

/**
 * Names `assignColors` and `colorOf` treat specially. Taking one would hand an
 * app the grey reserved for "everything else".
 */
const RESERVED = new Set(['other', 'unattributed']);

export type RenameError = 'unknown-app' | 'bad-name' | 'reserved' | 'taken';

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

/**
 * The name an app would be stored under, or why not.
 *
 * `current` is every app on the device as it is displayed right now (renames
 * included) beside the name it would have without one, keyed like `app_key`;
 * `base` is this app's. An empty name, or the base name itself, means "clear
 * the rename", and comes back as `base`.
 *
 * **Clearing is checked for collisions too.** Rename A away from "Alpha",
 * rename B to "Alpha", then reset A, and two apps showed "Alpha" -- the
 * colour-and-logo bug the rule exists for. A clash with an app that is NOT
 * renamed is let through: it was there before any rename, and refusing would
 * leave the rename impossible to undo.
 */
export function checkRename(opts: {
  key: string;
  name: unknown;
  current: Map<string, { name: string; base: string }>;
  base: string;
}): { ok: true; name: string } | { ok: false; error: RenameError } {
  const { key, current, base } = opts;
  if (!current.has(key)) return { ok: false, error: 'unknown-app' };

  const reset = typeof opts.name === 'string' && opts.name.trim() === '';
  const name = reset ? base : cleanName(opts.name);
  if (name === null) return { ok: false, error: 'bad-name' };

  const lower = name.toLowerCase();
  const toBase = name === base;
  if (!toBase && RESERVED.has(lower)) return { ok: false, error: 'reserved' };
  for (const [k, shown] of current) {
    if (k === key || shown.name.toLowerCase() !== lower) continue;
    if (toBase && shown.name === shown.base) continue;
    return { ok: false, error: 'taken' };
  }
  return { ok: true, name };
}
