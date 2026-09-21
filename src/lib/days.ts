/**
 * Calendar days, and which of them a device's history actually covers.
 *
 * Every per-day query returns rows only for the days that HAVE rows, and the
 * charts draw dates on a category axis, which places those rows side by side
 * however far apart they are. One phone moved data on 2026-06-28 and
 * 2026-09-21 and nothing in between, and its trend drew one straight rising
 * line across all 85 days: steady growth, from a phone idle for 84 of them.
 * Another had been doing the same over 86 empty days out of 113.
 *
 * A day with no rows means one of two very different things, and this file is
 * where the difference is decided:
 *
 * - **Inside collected history it is a real zero.** The phone was idle, the
 *   laptop was off, or (under a network scope) the laptop was on another
 *   network. Measured 2026-09-21: the laptop's three empty days, Aug 28, Aug 29
 *   and Sep 19, all sit inside SRUM windows that later collector runs read in
 *   full -- SRUM held those days and had nothing in them.
 * - **Outside it, nothing is known.** Before collection began, or across a
 *   stretch lost before anything collected it -- a collector down for longer
 *   than SRUM's retention, which is the reset this project exists to survive.
 *   Drawing that as zero would invent quiet days, which is the `--hm-none`
 *   rule the heat map already keeps.
 *
 * So a series is filled to one entry per day: real rows as they are, known
 * days as zero, unknown days as null. Recharts treats a null as a break point,
 * stacked or not (`isBreakPoint` in its Area), so an unknown stretch renders
 * as a visible gap -- never as zero, and never as a line bridging it.
 *
 * Pure functions, no database: `selftest.ts` exercises them directly.
 */

/** An inclusive run of local dates, `YYYY-MM-DD`. */
export interface DayRange {
  first: string;
  last: string;
}

/**
 * One day of a filled daily series. All three figures are null on a day
 * nothing collected, and 0 on a day known to be quiet.
 *
 * Anything counted "per active day" -- the mean behind the spike flag, an app's
 * `days` and first/last dates, the detail-page gate -- must come from the rows
 * BEFORE filling. Counting filled entries would call every day in the range
 * active and hand every app a detail page.
 */
export interface DailyPoint {
  date: string;
  sent: number | null;
  received: number | null;
  total: number | null;
}

export const quietDay = (date: string): DailyPoint => ({ date, sent: 0, received: 0, total: 0 });
export const unknownDay = (date: string): DailyPoint => ({ date, sent: null, received: null, total: null });

/** The later of two dates. */
export function laterOf(a: string, b: string): string {
  return a > b ? a : b;
}

const DAY_MS = 86_400_000;

/** `date` moved by `n` days. Plain calendar arithmetic, no timezone involved. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, both included; empty when `from` is later. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isKnown(date: string, known: DayRange[]): boolean {
  return known.some((r) => date >= r.first && date <= r.last);
}

/**
 * One entry per calendar day from `from` to `to`.
 *
 * A day with a row keeps it, whatever `known` says -- a row is proof enough. A
 * day without one gets `zero(date)` when `known` covers it and `unknown(date)`
 * otherwise.
 */
export function fillDays<T extends { date: string }>(
  rows: T[],
  from: string,
  to: string,
  known: DayRange[],
  zero: (date: string) => T,
  unknown: (date: string) => T,
): T[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return eachDay(from, to).map(
    (d) => byDate.get(d) ?? (isKnown(d, known) ? zero(d) : unknown(d)),
  );
}

/**
 * The local days a set of collection windows covers, merged.
 *
 * Each successful Windows collector run records the oldest and newest SRUM
 * rows it read, and those windows overlap from one run to the next -- SRUM
 * keeps 30+ days and the collector runs daily -- so on a healthy install they
 * merge into one range. They separate only where a stretch was never read,
 * which is exactly the case that must stay unknown.
 *
 * **A day counts only when a window covers ALL of it.** A window's first and
 * last days are partial, and an empty partial day is not proof the whole day
 * was quiet. `localDateOf` is injected so the boundary follows the same
 * timezone rule the ingest used to assign `local_date`.
 */
export function coveredDays(
  windows: { oldest: string; newest: string }[],
  localDateOf: (d: Date) => string,
): DayRange[] {
  const spans = windows
    .map((w) => ({ a: Date.parse(w.oldest), b: Date.parse(w.newest) }))
    .filter((w) => Number.isFinite(w.a) && Number.isFinite(w.b) && w.a <= w.b)
    .sort((x, y) => x.a - y.a);

  const merged: { a: number; b: number }[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.a <= last.b) last.b = Math.max(last.b, s.b);
    else merged.push({ ...s });
  }

  return merged
    .map(({ a, b }) => {
      const dayOfA = localDateOf(new Date(a));
      // `a` starts a whole day only when the instant before it is another day.
      const first = localDateOf(new Date(a - 1)) === dayOfA ? addDays(dayOfA, 1) : dayOfA;
      // Whatever time `b` falls at, its own day is not covered to the end.
      const last = addDays(localDateOf(new Date(b)), -1);
      return { first, last };
    })
    .filter((r) => r.first <= r.last);
}

/**
 * Every hour of the day, in order, the hours that moved nothing as zero.
 *
 * Hour of day is a category axis too, so an hour without rows used to vanish
 * and its neighbours closed up: on a machine that is off at 06:00 and 07:00,
 * 05 sat directly beside 08 and the chart read as consecutive busy hours. It
 * went unseen on a machine that is never idle for a whole hour of the day;
 * the demo history, which is, showed it at once.
 *
 * `step` is 2 for the phone, whose buckets are two hours long: only the hours
 * a bucket can start on are filled, or every other bar would be a false zero.
 * Should the rows ever hold both odd and even hours -- the phone's UTC offset
 * changed across the range -- it fills all 24 instead, because a row must
 * never be dropped to make the axis tidy.
 */
export function fillHours<T extends { hour: number }>(
  rows: T[],
  zero: (hour: number) => T,
  step: 1 | 2 = 1,
): T[] {
  if (rows.length === 0) return [];
  const parities = new Set(rows.map((r) => r.hour % 2));
  const stride = step === 2 && parities.size === 1 ? 2 : 1;
  const start = stride === 2 ? rows[0]!.hour % 2 : 0;
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  const out: T[] = [];
  for (let h = start; h < 24; h += stride) out.push(byHour.get(h) ?? zero(h));
  return out;
}

/**
 * "87 days, 84 with traffic" -- the span a filled series draws, and how much of
 * it moved anything. Unknown days are counted in neither.
 */
export function daySpanLabel(daily: { total: number | null }[]): string {
  const known = daily.filter((d) => d.total !== null).length;
  const active = daily.filter((d) => (d.total ?? 0) > 0).length;
  const days = `${known} day${known === 1 ? '' : 's'}`;
  return active === known ? days : `${days}, ${active} with traffic`;
}
