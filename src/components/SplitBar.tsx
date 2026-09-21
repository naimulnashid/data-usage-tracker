'use client';

import { CountUp } from './CountUp';
import { formatBytes, formatPercent, splitBytes } from '@/lib/format';
import { colorOf, EVERYTHING_ELSE_COLOR, type AppColorMap } from '@/lib/app-colors';
import type { AppIconMap } from '@/lib/app-icons';
import { AppIcon } from './AppIcon';

/**
 * One app against everything else: the app named by `splitApp` in
 * config/collector.json.
 *
 * When one app dominates the total -- a torrent client easily can -- a single
 * undifferentiated total (or one bar chart including it) flattens every other
 * app into invisibility. Separating the two lets the remainder be read at a
 * scale where browsers, sync clients and the rest are distinguishable.
 */
export function SplitBar({
  app, focus, other, focusPct, colors, icons,
}: {
  /** Display name of the split-out app. */
  app: string;
  focus: number; other: number; focusPct: number;
  colors: AppColorMap; icons: AppIconMap;
}) {
  const focusColor = colorOf(colors, app);
  const otherPct = 100 - focusPct;

  return (
    <div>
      {/* Decorative: the two halves below state the same figures as text. */}
      <div aria-hidden="true" style={{ display: 'flex', height: 16, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-inset)' }}>
        <div
          style={{
            width: `${focusPct}%`, background: focusColor,
            transformOrigin: 'left', animation: 'grow 800ms var(--ease) both',
          }}
          title={`${app} — ${formatBytes(focus)}`}
        />
        <div
          style={{
            width: `${otherPct}%`, background: EVERYTHING_ELSE_COLOR,
            transformOrigin: 'left', animation: 'grow 800ms var(--ease) 120ms both',
          }}
          title={`Everything else — ${formatBytes(other)}`}
        />
      </div>

      <div className="grid grid--2" style={{ marginTop: '1.6rem' }}>
        <Half label={app} bytes={focus} pct={focusPct} color={focusColor} icons={icons} />
        <Half label="Everything else" bytes={other} pct={otherPct} color={EVERYTHING_ELSE_COLOR} />
      </div>
    </div>
  );
}

function Half({
  label, bytes, pct, color, icons,
}: {
  label: string; bytes: number; pct: number; color: string;
  /** "Everything else" is not an app, so only the named half gets a logo. */
  icons?: AppIconMap;
}) {
  const { unit } = splitBytes(bytes);
  return (
    <div>
      <div className="legend-item" style={{ fontSize: 'var(--fs-small)' }}>
        {icons
          ? <AppIcon name={label} color={color} icons={icons} size={15} />
          : <span className="legend-swatch" style={{ background: color }} />}
        {label}
      </div>
      <div className="stat-value" style={{ color, marginTop: '0.3rem' }}>
        <CountUp value={bytes} mode="bytesValue" />
        <span className="stat-unit">{unit}</span>
      </div>
      <div className="stat-sub">{formatPercent(pct)} of named traffic</div>
    </div>
  );
}
