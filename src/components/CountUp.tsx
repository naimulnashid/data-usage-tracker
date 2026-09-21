'use client';

import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatCount, formatPercent, splitBytes } from '@/lib/format';

/**
 * How to render the animated number.
 *
 * A mode string rather than a formatter function, because most callers are
 * server components and functions cannot cross the server/client boundary.
 */
export type CountUpMode = 'bytesValue' | 'bytes' | 'count' | 'percent';

const FORMATTERS: Record<CountUpMode, (n: number) => string> = {
  // Just the number; the caller renders the unit separately so it can be
  // styled down. The unit is taken from the FINAL value, not the animated one,
  // so it does not flicker through KB -> MB -> GB on the way up.
  bytesValue: (n) => splitBytes(n).value,
  bytes: (n) => formatBytes(n),
  count: (n) => formatCount(Math.round(n)),
  percent: (n) => formatPercent(n),
};

interface Props {
  value: number;
  mode?: CountUpMode;
  durationMs?: number;
  className?: string;
}

/**
 * Counts a number up on mount.
 *
 * Eased rather than linear so it decelerates into the final value instead of
 * stopping dead. Honours prefers-reduced-motion by rendering the final value
 * immediately, and always lands exactly on `value` rather than on whatever the
 * last animation frame happened to produce.
 */
export function CountUp({ value, mode = 'bytesValue', durationMs = 900, className }: Props) {
  const [display, setDisplay] = useState(value);
  const frame = useRef<number>(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || value === 0) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, durationMs]);

  // Scale the in-flight number by the FINAL value's unit, so an animation
  // ending at "2.40 TB" counts up in TB rather than racing through GB.
  const format = FORMATTERS[mode];
  const text =
    mode === 'bytesValue'
      ? scaleToFinalUnit(display, value)
      : format(display);

  return <span className={className}>{text}</span>;
}

function scaleToFinalUnit(current: number, final: number): string {
  const { value: finalValue, unit } = splitBytes(final);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const power = Math.max(0, units.indexOf(unit));
  const divisor = 1024 ** power;
  const decimals = (finalValue.split('.')[1] ?? '').length;
  return (current / divisor).toFixed(decimals);
}
