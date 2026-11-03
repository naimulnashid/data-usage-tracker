'use client';

import { useEffect, useRef, useState } from 'react';
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
 *
 * A button and a list, not a native `<select>`: the browser draws a select's
 * open list itself, as wide as the pill and indented by the select's own
 * padding, which here was zero -- so on Windows the options sat flush
 * against the list's left edge, in the OS's colours rather than the theme's.
 */
export function RangeMenu({
  value, onChange, label,
}: {
  value: ChartRange;
  onChange: (days: ChartRange) => void;
  /** What the range applies to, for assistive tech ("Daily by app range"). */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Outside clicks and Escape close it, as any menu does.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); button.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Focus the current choice, so the arrow keys start from it.
    list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(days: ChartRange) {
    onChange(days);
    setOpen(false);
    button.current?.focus();
  }

  function onListKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <span className="range-menu-wrap" ref={root}>
      <button
        ref={button}
        type="button"
        className="range-menu"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${rangeName(value)}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); }
        }}
      >
        <CalendarIcon size={15} />
        {rangeLabel(value)}
        <span className="range-menu-caret" aria-hidden />
      </button>
      {open && (
        <div className="app-menu range-menu-list" role="listbox" aria-label={label} ref={list} onKeyDown={onListKey}>
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              role="option"
              aria-selected={d === value}
              className="app-menu-item"
              onClick={() => pick(d)}
            >
              {rangeName(d)}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
