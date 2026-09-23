/**
 * The calendar arithmetic behind the activity heat map, shared by the six-month
 * card on each overview and the full-history page it expands into.
 *
 * Both draw the same thing -- blocks of `WEEKS` Saturday-first week columns --
 * so they share one builder. The full page is just more blocks of the same
 * width stacked vertically, which is what keeps its cells the size of the
 * overview's rather than shrinking as history grows.
 */

/**
 * Six months of history per block. `WEEKS` is the single source of truth for
 * the column count -- the component sets the grid template from it inline, so
 * the CSS never hard-codes it.
 */
export const WEEKS = 26;

/**
 * Where the expanded page begins, unless data is older than this.
 *
 * A fixed date rather than "the first day with data": the page reads as a
 * calendar, and a calendar that opens on 27 May because a phone happened to be
 * added then reads as truncated. Collection on this install began in 2026.
 */
export const EXPANDED_FROM = '2026-01-01';

/** Weeks run Saturday -> Friday, so row 0 is Saturday. */
export const DAY_LABELS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface HeatmapDay {
  date: string;
  total: number;
}

export interface HeatmapCell {
  date: string;
  total: number;
  /** A day the data covers. Unknown days are drawn as "no data collected". */
  known: boolean;
  /** After today, or before the block's `from`: not drawn at all. */
  hidden: boolean;
  column: number;
  row: number;
}

export interface HeatmapBlock {
  cells: HeatmapCell[];
  months: Array<{ label: string; column: number }>;
  /** First and last day the block draws -- `from`-clipped, not today-clipped. */
  first: string;
  last: string;
  peak: number;
  total: number;
  activeDays: number;
}

const DAY_MS = 86_400_000;

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Local midnight today, expressed in UTC terms so the arithmetic stays on whole
 * days. `local_date` is already machine-local, so the last column lines up with
 * the user's calendar day.
 */
export function localToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Saturday-first: Sat = 6 in getUTCDay(), so (day + 1) % 7 puts it at row 0. */
function rowOf(date: Date): number {
  return (date.getUTCDay() + 1) % 7;
}

function weekStartOf(date: Date): Date {
  return addDays(date, -rowOf(date));
}

/**
 * One block of `WEEKS` columns starting on `firstWeek` (a Saturday).
 *
 * Days before `from` are hidden rather than drawn as "no data": they are
 * outside what the page is showing, not a gap in what was collected.
 */
function buildBlock(
  byDate: Map<string, number>,
  firstWeek: Date,
  today: Date,
  from: Date | null,
): HeatmapBlock {
  const cells: HeatmapCell[] = [];
  const months: HeatmapBlock['months'] = [];
  let peak = 0;
  let total = 0;
  let activeDays = 0;
  let lastMonth = -1;

  for (let column = 0; column < WEEKS; column += 1) {
    const weekStart = addDays(firstWeek, column * 7);

    // Label a column by the first day it actually draws, so a block clipped
    // to 1 January opens on "Jan" rather than on the December days it hides.
    const labelDay = from && weekStart < from ? from : weekStart;
    const month = labelDay.getUTCMonth();
    if (month !== lastMonth) {
      months.push({ label: MONTH_NAMES[month]!, column });
      lastMonth = month;
    }

    for (let row = 0; row < 7; row += 1) {
      const cellDate = addDays(weekStart, row);
      const date = isoDay(cellDate);
      const hidden = cellDate > today || (from !== null && cellDate < from);
      const known = !hidden && byDate.has(date);
      const value = byDate.get(date) ?? 0;

      if (known) {
        peak = Math.max(peak, value);
        total += value;
        if (value > 0) activeDays += 1;
      }

      cells.push({ date, total: value, known, hidden, column, row });
    }
  }

  // A block opening on a month's last week or two labels that month in column
  // 0 and the next one right beside it, and "JunJul" overlap. Drop the stub.
  if (months.length > 1 && months[1]!.column - months[0]!.column < 3) months.shift();

  const start = from && firstWeek < from ? from : firstWeek;
  return {
    cells, months, peak, total, activeDays,
    first: isoDay(start),
    last: isoDay(addDays(firstWeek, WEEKS * 7 - 1)),
  };
}

function toMap(daily: HeatmapDay[]): Map<string, number> {
  return new Map(daily.map((d) => [d.date, d.total]));
}

/** The overview's block: the `WEEKS` weeks ending with the current one. */
export function recentBlock(daily: HeatmapDay[], today = localToday()): HeatmapBlock {
  const firstWeek = addDays(weekStartOf(today), -(WEEKS - 1) * 7);
  return buildBlock(toMap(daily), firstWeek, today, null);
}

/**
 * True when there is data older than the overview's block can show -- the
 * condition for offering the expanded page at all.
 */
export function hasOlderThanRecent(earliest: string | null, today = localToday()): boolean {
  if (!earliest) return false;
  return earliest < recentBlock([], today).first;
}

/**
 * Every block from `EXPANDED_FROM` (or the earliest data, if older) to today,
 * oldest first. Consecutive blocks are contiguous weeks, so no week is split
 * or drawn twice where one block meets the next.
 */
export function expandedBlocks(
  daily: HeatmapDay[],
  earliest: string | null,
  today = localToday(),
): HeatmapBlock[] {
  const byDate = toMap(daily);
  const startIso = earliest && earliest < EXPANDED_FROM ? earliest : EXPANDED_FROM;
  const from = parseDay(startIso);

  const blocks: HeatmapBlock[] = [];
  for (let week = weekStartOf(from); week <= today; week = addDays(week, WEEKS * 7)) {
    blocks.push(buildBlock(byDate, week, today, from));
  }
  return blocks;
}

/** "Jan 1 – Jun 26, 2026", or with both years when a block spans New Year. */
export function blockLabel(block: HeatmapBlock): string {
  const short = (iso: string) => {
    const d = parseDay(iso);
    return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
  };
  const y1 = block.first.slice(0, 4);
  const y2 = block.last.slice(0, 4);
  return y1 === y2
    ? `${short(block.first)} – ${short(block.last)}, ${y2}`
    : `${short(block.first)}, ${y1} – ${short(block.last)}, ${y2}`;
}
