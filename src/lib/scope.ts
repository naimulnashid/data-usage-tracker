/**
 * Shared range constants.
 *
 * Lives apart from `queries.ts` because that module is `server-only` and the
 * range menus are client components -- both need these numbers.
 *
 * **Pages are not scoped any more** (since 3.7.0). The top bar's 7d / 30d /
 * 90d / All chips scoped every figure on every page; the user asked for them
 * to go, so every page reads all history and only the two daily charts --
 * Daily by app, and an app's Daily usage -- carry a range of their own, in a
 * menu at their top right. An old link carrying `?days=` shows everything
 * rather than a filter with no visible control, exactly as `?profile=` did
 * when the network selector went.
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

/** Ranges offered in a chart's menu, shortest first. */
export const RANGES = [7, 30, 90, ALL_DAYS] as const;

export type ChartRange = (typeof RANGES)[number];

/** What a chart's menu opens on. A month: readable bars, recent enough to matter. */
export const DEFAULT_CHART_DAYS: ChartRange = 30;

export function rangeLabel(days: number): string {
  return days === ALL_DAYS ? 'All' : `${days}d`;
}

/** Spoken label, for the menu's options. */
export function rangeName(days: number): string {
  return days === ALL_DAYS ? 'All history' : `Last ${days} days`;
}

/**
 * The tail of a day-by-day series that a range covers: its last `days`
 * entries, counted back from the newest day, as the queries anchor ranges.
 * The series is one entry per day (lib/days.ts), so a count is a date span.
 */
export function lastDays<T>(series: T[], days: number): T[] {
  return days >= series.length ? series : series.slice(series.length - days);
}
