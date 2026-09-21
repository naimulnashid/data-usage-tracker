'use client';

import { useMemo } from 'react';
import { formatBytes, formatDayLong } from '@/lib/format';
import { HEATMAP_RAMP, heatmapColor } from '@/lib/app-colors';

/**
 * Six months of history. `WEEKS` is the single source of truth for the column
 * count -- it drives the grid template inline, so the CSS never hard-codes it.
 * Keep `RANGE_LABEL` in step if you change it.
 */
const WEEKS = 26;
const RANGE_LABEL = '6 months';

/** Weeks run Saturday -> Friday, so row 0 is Saturday. */
const DAY_LABELS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface HeatmapDay {
  date: string;
  total: number;
}

interface Cell {
  date: string;
  total: number;
  known: boolean;
  future: boolean;
  column: number;
  row: number;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Daily total over `RANGE_LABEL`, GitHub-style, coloured with the accent ramp.
 *
 * Month labels, weekday labels and cells all live in ONE grid with explicit
 * placement. That is what keeps the three registered with each other: the cells
 * size themselves from the shared column tracks, and the weekday labels inherit
 * the same row heights, so nothing can drift out of alignment.
 *
 * Cells are fluid (`1fr` columns plus `aspect-ratio: 1`) rather than a fixed
 * pixel size, so the grid fills whatever width the panel has and stays square
 * at any width. Fewer weeks therefore produce *larger* cells.
 *
 * Cells use native `title` tooltips deliberately. A styled, absolutely
 * positioned tooltip inside this grid would contribute layout width to the
 * scroll container even while hidden, which produces a phantom horizontal
 * scrollbar.
 *
 * Days with no row at all are drawn as "no data" rather than as a zero. Before
 * collection started there is genuinely nothing to report, and colouring that
 * the same as a real quiet day would invent history the project does not have.
 */
export function ActivityHeatmap({ daily }: { daily: HeatmapDay[] }) {
  const { cells, months, max, total, activeDays } = useMemo(() => {
    const byDate = new Map(daily.map((d) => [d.date, d.total]));

    // Local midnight today, expressed in UTC terms so the arithmetic below
    // stays on whole days. local_date is already machine-local, so the last
    // column lines up with the user's calendar day.
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

    // Saturday-first weeks: Sat = 6 in getUTCDay(), so (day + 1) % 7 puts
    // Saturday at row 0 and Friday at row 6.
    const rowOf = (date: Date) => (date.getUTCDay() + 1) % 7;

    const currentWeekStart = new Date(today);
    currentWeekStart.setUTCDate(today.getUTCDate() - rowOf(today));

    const flat: Cell[] = [];
    const monthMarks: Array<{ label: string; column: number }> = [];
    let peak = 0;
    let sum = 0;
    let active = 0;
    let lastMonth = -1;

    for (let w = WEEKS - 1; w >= 0; w -= 1) {
      const column = WEEKS - 1 - w;
      const weekStart = new Date(currentWeekStart);
      weekStart.setUTCDate(currentWeekStart.getUTCDate() - w * 7);

      const month = weekStart.getUTCMonth();
      if (month !== lastMonth) {
        monthMarks.push({ label: MONTH_NAMES[month]!, column });
        lastMonth = month;
      }

      for (let d = 0; d < 7; d += 1) {
        const cellDate = new Date(weekStart);
        cellDate.setUTCDate(weekStart.getUTCDate() + d);
        const key = isoDay(cellDate);
        const known = byDate.has(key);
        const value = byDate.get(key) ?? 0;

        if (known) {
          peak = Math.max(peak, value);
          sum += value;
          if (value > 0) active += 1;
        }

        flat.push({
          date: key,
          total: value,
          known,
          future: cellDate.getTime() > today.getTime(),
          column,
          row: d,
        });
      }
    }

    return { cells: flat, months: monthMarks, max: peak, total: sum, activeDays: active };
  }, [daily]);

  return (
    <div>
      <div className="heatmap-scroll">
        <div
          className="heatmap-plot"
          role="img"
          aria-label={`Daily data usage over the last ${RANGE_LABEL}`}
          style={{
            gridTemplateColumns: `var(--hm-daycol) repeat(${WEEKS}, minmax(var(--hm-min), 1fr))`,
          }}
        >
          {months.map((mark) => (
            <span
              key={`${mark.label}-${mark.column}`}
              className="heatmap-month"
              style={{ gridColumn: mark.column + 2, gridRow: 1 }}
              aria-hidden
            >
              {mark.label}
            </span>
          ))}

          {DAY_LABELS.map((label, i) => (
            <span
              key={label}
              className="heatmap-day"
              style={{ gridColumn: 1, gridRow: i + 2 }}
              aria-hidden
            >
              {label}
            </span>
          ))}

          {cells.map((cell) => {
            const title = cell.future
              ? ''
              : cell.known
                ? `${formatDayLong(cell.date)} - ${formatBytes(cell.total)}`
                : `${formatDayLong(cell.date)} - no data collected`;
            return (
              <span
                key={cell.date}
                className="heatmap-cell"
                data-nodata={!cell.future && !cell.known}
                title={title}
                style={{
                  gridColumn: cell.column + 2,
                  gridRow: cell.row + 2,
                  background: cell.future
                    ? 'transparent'
                    : cell.known
                      ? heatmapColor(cell.total, max)
                      : 'var(--hm-none)',
                  visibility: cell.future ? 'hidden' : 'visible',
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="heatmap-legend">
        <span>
          {formatBytes(total)} across {activeDays} active {activeDays === 1 ? 'day' : 'days'} in
          the last {RANGE_LABEL}
        </span>
        <span className="heatmap-scale">
          Less
          {HEATMAP_RAMP.map((color) => (
            <span key={color} className="heatmap-swatch" style={{ background: color }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
