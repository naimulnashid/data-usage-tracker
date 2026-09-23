/**
 * Shared scope constants.
 *
 * Lives apart from `queries.ts` because that module is `server-only` and the
 * scope bar is a client component -- both need these numbers.
 */

/**
 * The "All" range.
 *
 * A large day count rather than a sentinel like 0, so every query keeps using
 * the same `local_date >= ?` comparison and there is no special case to forget.
 * Anchored on the newest stored day, 36,500 days reaches back a century, which
 * covers all history without pretending to be unbounded.
 */
export const ALL_DAYS = 36500;

/** Ranges offered in the scope bar, shortest first. */
export const RANGES = [7, 30, 90, ALL_DAYS] as const;

/** Opening view. All history, so the dashboard leads with everything it holds. */
export const DEFAULT_DAYS = ALL_DAYS;

export function rangeLabel(days: number): string {
  return days === ALL_DAYS ? 'All' : `${days}d`;
}

/**
 * Parse `?days=` into a whole number of days from 1 to ALL_DAYS, falling back
 * to the default for anything else.
 *
 * Bounded, because the value goes straight into date arithmetic: it used to
 * accept any positive number, and `?days=1e9` moved a Date past its range, so
 * `toISOString()` threw `RangeError: Invalid time value` and the page died.
 * Not restricted to the four offered ranges, because an old bookmark such as
 * `?days=365` is a perfectly good question to keep answering.
 */
export function parseDays(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= ALL_DAYS ? n : DEFAULT_DAYS;
}

/**
 * `?days=` and `?profile=` as a query suffix ("" when neither is set), for a
 * link between two views of one device that must not reset the reader's scope.
 */
export function scopeQuery(sp: { days?: string; profile?: string }): string {
  const q = new URLSearchParams();
  if (sp.days) q.set('days', sp.days);
  if (sp.profile) q.set('profile', sp.profile);
  const s = q.toString();
  return s ? `?${s}` : '';
}
