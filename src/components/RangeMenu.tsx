'use client';

import { RANGES, rangeLabel, rangeName, type ChartRange } from '@/lib/scope';
import { CalendarIcon } from './Icons';

/**
 * A chart's own range: 7d, 30d, 90d or All, in its card's top right.
 *
 * It replaced the top bar's range chips (3.7.0), which scoped every figure on
 * every page. Only the daily charts carry one, because a day-by-day picture is
 * the one thing that reads differently at a month and at a year; every other
 * figure on the page covers all history.
 *
 * Local state, not the URL: the data for every range is already on the page,
 * so switching is instant and re-renders nothing else.
 */
export function RangeMenu({
  value, onChange, label,
}: {
  value: ChartRange;
  onChange: (days: ChartRange) => void;
  /** What the range applies to, for assistive tech ("Daily by app range"). */
  label: string;
}) {
  return (
    <label className="range-menu">
      <CalendarIcon size={15} />
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value) as ChartRange)}
      >
        {RANGES.map((d) => (
          <option key={d} value={d} title={rangeName(d)}>{rangeLabel(d)}</option>
        ))}
      </select>
    </label>
  );
}
