'use client';

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { useId, type ReactNode } from 'react';
import { colorOf, uploadTint, type AppColorMap } from '@/lib/app-colors';
import type { AppIconMap } from '@/lib/app-icons';
import { AppIcon } from './AppIcon';
import { formatBytes, formatDayShort, formatPercent } from '@/lib/format';
import type { DailyPoint } from '@/lib/days';

// Tick labels are text, drawn in the axis stroke colour, so they take the same
// --text-faint that clears 4.5:1 (the old #6b6b76 was 3.99:1 on black).
const AXIS = { stroke: 'var(--text-faint)', fontSize: 13 };
const GRID = '#1a1a1e';

/*
  Download / upload shades of the one accent.
  Darker = download, lighter = upload. Two shades of the SAME hue rather than
  two colours, because these are two halves of one quantity -- a second hue
  would read as a second, unrelated series.

  Expressed against the accent variables rather than as hexes, so a device with
  a different accent repaints them. Recharts passes stroke and fill straight
  through to SVG attributes, where `var(--x)` and `color-mix()` are both valid.
*/
const DOWN_COLOR = 'color-mix(in srgb, var(--accent) 78%, #000)';
const UP_COLOR = 'color-mix(in srgb, var(--accent-bright) 72%, #fff)';

/** Bytes -> compact axis label. Axis ticks need to stay narrow. */
const tickBytes = (v: number) => formatBytes(v, 0);

/*
  Every chart carries a text alternative (WCAG 1.1.1). An SVG of bars says
  nothing to a screen reader; Recharts' accessibility layer adds keyboard
  tooltips, not a summary. So each chart is a labelled figure whose
  description states what the chart shows -- span, total, busiest point --
  computed here from the chart's own data, so no page has to remember to.

  A div with role="figure" rather than a <figure>: the element's default
  margins would shift every page, and the loading skeletons are measured
  against the current layout to the pixel.
*/
function ChartFigure({ label, summary, children }: {
  label: string; summary: string; children: ReactNode;
}) {
  const id = useId();
  return (
    <div role="figure" aria-label={label} aria-describedby={id}>
      <p id={id} className="sr-only">{summary}</p>
      {children}
    </div>
  );
}

/** One sentence for a daily series. Days nothing was collected for are skipped. */
function dailySummary(data: DailyPoint[], what: string): string {
  const known = data.filter((d) => d.total !== null);
  const first = data[0];
  const last = data[data.length - 1];
  if (!first || !last || known.length === 0) return `${what}: nothing collected in this range.`;
  const peak = known.reduce((a, b) => ((b.total ?? 0) > (a.total ?? 0) ? b : a));
  const total = known.reduce((s, d) => s + (d.total ?? 0), 0);
  const active = known.filter((d) => (d.total ?? 0) > 0).length;
  return `${what}, ${formatDayShort(first.date)} to ${formatDayShort(last.date)}: `
    + `${formatBytes(total)} over ${active} active day${active === 1 ? '' : 's'}. `
    + `Busiest day ${formatDayShort(peak.date)}, ${formatBytes(peak.total ?? 0)}.`;
}

function TooltipShell({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div
      style={{
        background: '#0c0c0e',
        border: '1px solid #2c2c33',
        borderRadius: 10,
        padding: '0.7rem 0.9rem',
        fontSize: 14,
        boxShadow: '0 12px 30px rgba(0,0,0,0.7)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <div style={{ color: '#f5f5f7', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

interface Payload {
  name?: string | number;
  value?: number | null;
  color?: string;
  dataKey?: string | number;
}

/*
  Daily series arrive filled to one entry per day (lib/days.ts): 0 on a day
  known to be quiet, null on a day nothing was collected for. Recharts draws a
  null as a break, so the line stops rather than sloping across a gap; the
  tooltip has to say which of the two a day is, because "0 B" and "never
  collected" are different answers.
*/
function NoDataNote() {
  return <div style={{ color: '#a1a1aa' }}>No data collected</div>;
}

/* ------------------------------------------------------------- daily trend */

export function DailyTrendChart({
  data,
  mean,
}: {
  data: DailyPoint[];
  /** Mean daily total over active days; days well above it are flagged red. */
  mean: number;
}) {
  // A "spike" is >2.5x the mean. Red is reserved for genuine anomalies, so the
  // threshold is set high enough that a normal busy day does not trip it.
  const spikeAt = mean * 2.5;

  const spikeDays = data.filter((d) => spikeAt > 0 && (d.total ?? 0) > spikeAt).length;
  return (
    <ChartFigure
      label="Daily total"
      summary={`${dailySummary(data, 'Daily total')}${spikeDays ? ` ${spikeDays} day${spikeDays === 1 ? '' : 's'} well above trend.` : ''}`}
    >
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={formatDayShort} {...AXIS} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tickFormatter={tickBytes} {...AXIS} tickLine={false} axisLine={false} width={64} />
        <Tooltip
          cursor={{ stroke: 'var(--accent)', strokeWidth: 1, strokeDasharray: '4 4' }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]?.payload as DailyPoint;
            if (p.total === null) {
              return <TooltipShell label={formatDayShort(String(label))}><NoDataNote /></TooltipShell>;
            }
            const spike = spikeAt > 0 && p.total > spikeAt;
            return (
              <TooltipShell label={formatDayShort(String(label))}>
                <div style={{ color: spike ? 'var(--danger)' : 'var(--accent-bright)', fontSize: 17, fontWeight: 650 }}>
                  {formatBytes(p.total)}
                  {spike && <span style={{ fontSize: 12, marginLeft: 6 }}>above trend</span>}
                </div>
                <div style={{ color: '#a1a1aa', marginTop: 4 }}>
                  ↑ {formatBytes(p.sent ?? 0)} &nbsp; ↓ {formatBytes(p.received ?? 0)}
                </div>
              </TooltipShell>
            );
          }}
        />
        <Area
          type="monotone" dataKey="total" stroke="var(--accent)" strokeWidth={2}
          fill="url(#trendFill)" animationDuration={900} animationEasing="ease-out"
          dot={false} activeDot={{ r: 5, fill: 'var(--accent-bright)', stroke: '#000', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
    </ChartFigure>
  );
}

/* ---------------------------------------------------------------- top apps */

/** One bar's worth of app, with everything the tooltip needs. */
export interface TopApp {
  name: string;
  total: number;
  sent: number;
  received: number;
  /** Percent of attributed traffic in the same scope. */
  share: number;
}

/**
 * One bar per app: download and upload, STACKED.
 *
 * Note what was reverted here previously and why, because it is a different
 * chart from this one. GROUPED bars -- download and upload side by side, two
 * rows per app -- doubled the chart's height and made comparing ten apps by
 * size harder, which is the one thing a "Top 10" exists to do. Stacking has
 * neither cost: still one row per app, still `data.length * 44` high, and the
 * full bar length is still the total, so the ranking reads exactly as it did
 * when the bar was undivided. What it adds is the sent/received ratio at a
 * glance across all ten -- a torrent client and a browser have visibly
 * different shapes -- which the tooltip could only ever show one app at a time.
 *
 * Upload is a tint of the app's own colour rather than a second hue, so the
 * two halves read as one app. `uploadTint()` picks the direction; see
 * `app-colors.ts` for why it cannot simply always lighten.
 */
export function TopAppsChart({
  data, colors, icons,
}: {
  data: TopApp[];
  colors: AppColorMap;
  icons: AppIconMap;
}) {
  return (
    <ChartFigure
      label="Apps that moved the most data"
      summary={data.length === 0 ? 'No app traffic in this range.' : `Apps that moved the most data: ${data.slice(0, 5).map((a) => `${a.name} ${formatBytes(a.total)}`).join(', ')}${data.length > 5 ? `, and ${data.length - 5} more` : ''}.`}
    >
    <ResponsiveContainer width="100%" height={Math.max(260, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tickFormatter={tickBytes} {...AXIS} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" {...AXIS} tickLine={false} axisLine={false} width={140} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            // Read the whole row rather than just the bar's value: the split
            // and the share are the parts a bar length cannot show, and they
            // are what make the tooltip worth opening.
            const p = payload[0]?.payload as TopApp | undefined;
            if (!p) return null;
            const color = colorOf(colors, p.name);
            const downShare = p.total > 0 ? (p.received / p.total) * 100 : 0;
            return (
              <TooltipShell
                label={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AppIcon name={p.name} color={color} icons={icons} size={17} />
                    {p.name}
                  </span>
                }
              >
                <div style={{ color, fontSize: 17, fontWeight: 650 }}>
                  {formatBytes(p.total)}
                  <span style={{ color: '#a1a1aa', fontSize: 13, fontWeight: 500, marginLeft: 7 }}>
                    {formatPercent(p.share)} of traffic
                  </span>
                </div>
                {/* One per line. Side by side the two figures read as a single
                    run-on number, and the percentages made that worse. The
                    arrows carry the meaning; the same pair is used on every
                    score card, so spelling it out here would be the only place
                    that does. */}
                <div style={{ color: '#a1a1aa', marginTop: 6, display: 'grid', gap: 3 }}>
                  <span>
                    &darr; {formatBytes(p.received)}
                    <span style={{ color: '#6b6b76', marginLeft: 6 }}>{formatPercent(downShare)}</span>
                  </span>
                  <span>
                    &uarr; {formatBytes(p.sent)}
                    <span style={{ color: '#6b6b76', marginLeft: 6 }}>{formatPercent(100 - downShare)}</span>
                  </span>
                </div>
              </TooltipShell>
            );
          }}
        />
        {/*
          Download first, to match the down-then-up order the score cards, the
          tooltip and the detail page all use. NOT because it is the larger
          half -- measured on real data it frequently is not: Google Drive is
          91% upload over 30 days, Claude 83%, Edge 59%. So the app's brand
          colour can end up a sliver of its own bar, and that is the chart
          working: the row label, the table swatch and the logo carry identity,
          while the bar carries the ratio.

          The radius goes on the upload segment alone, since it is the one that
          ends the bar.
        */}
        <Bar dataKey="received" stackId="io" animationDuration={800} animationEasing="ease-out">
          {data.map((d) => (
            <Cell key={d.name} fill={colorOf(colors, d.name)} />
          ))}
        </Bar>
        <Bar dataKey="sent" stackId="io" radius={[0, 6, 6, 0]} animationDuration={800} animationEasing="ease-out">
          {data.map((d) => (
            <Cell key={d.name} fill={uploadTint(colorOf(colors, d.name))} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </ChartFigure>
  );
}

/* ---------------------------------------------------------------- timeline */

export function StackedTimelineChart({
  data,
  series,
  colors,
}: {
  /** One point per day; a series is null on a day nothing was collected. */
  data: Record<string, string | number | null>[];
  series: string[];
  colors: AppColorMap;
}) {
  const seriesTotals = series
    .map((s) => ({ s, t: data.reduce((sum, row) => sum + (typeof row[s] === 'number' ? (row[s] as number) : 0), 0) }))
    .sort((a, b) => b.t - a.t);
  return (
    <ChartFigure
      label="Daily usage by app"
      summary={`Daily usage stacked by app over ${data.length} days. Largest: ${seriesTotals.slice(0, 5).map((x) => `${x.s} ${formatBytes(x.t)}`).join(', ')}.`}
    >
    <ResponsiveContainer width="100%" height={380}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={(v) => formatDayShort(String(v))} {...AXIS} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tickFormatter={tickBytes} {...AXIS} tickLine={false} axisLine={false} width={64} />
        <Tooltip
          cursor={{ stroke: 'var(--accent)', strokeWidth: 1, strokeDasharray: '4 4' }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            if ((payload as readonly Payload[]).every((p) => p.value == null)) {
              return <TooltipShell label={formatDayShort(String(label))}><NoDataNote /></TooltipShell>;
            }
            // Largest first, and drop zero-byte series -- a stacked tooltip
            // listing eight apps at "0 B" buries the one that matters.
            const rows = (payload as readonly Payload[])
              .slice()
              .filter((p) => Number(p.value ?? 0) > 0)
              .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));
            const total = rows.reduce((a, p) => a + Number(p.value ?? 0), 0);
            return (
              <TooltipShell label={formatDayShort(String(label))}>
                <div style={{ color: 'var(--accent-bright)', fontWeight: 650, fontSize: 16, marginBottom: 6 }}>
                  {formatBytes(total)}
                </div>
                {rows.slice(0, 9).map((p) => (
                  <div key={String(p.dataKey)} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', color: '#d4d4d8' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color }} />
                      {String(p.dataKey)}
                    </span>
                    <span>{formatBytes(Number(p.value ?? 0))}</span>
                  </div>
                ))}
              </TooltipShell>
            );
          }}
        />
        {series.map((name, i) => (
          <Area
            key={name}
            type="monotone"
            dataKey={name}
            stackId="1"
            stroke={colorOf(colors, name)}
            fill={colorOf(colors, name)}
            fillOpacity={0.72}
            strokeWidth={1}
            animationDuration={700}
            animationBegin={i * 45}
            animationEasing="ease-out"
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------ hour-of-day */

export function HourlyChart({
  data,
}: {
  data: { hour: number; sent: number; received: number; total: number }[];
}) {
  const peak = Math.max(...data.map((d) => d.total), 0);
  const busiest = data.reduce((a, b) => (b.total > a.total ? b : a), data[0] ?? { hour: 0, total: 0 });
  const quietest = data.reduce((a, b) => (b.total < a.total ? b : a), data[0] ?? { hour: 0, total: 0 });
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return (
    <ChartFigure
      label="Usage by hour of day"
      summary={data.length === 0 ? 'No hourly data in this range.' : `Usage by hour of day. Busiest ${hh(busiest.hour)}, ${formatBytes(busiest.total)}; quietest ${hh(quietest.hour)}, ${formatBytes(quietest.total)}.`}
    >
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        {/* interval={0} labels EVERY bucket. This carried interval={1} -- show
            every other tick -- which on the Android chart hid half of a 12-bar
            axis and made the 2-hour spacing impossible to read off. */}
        <XAxis
          dataKey="hour"
          tickFormatter={(h) => String(h).padStart(2, '0')}
          {...AXIS}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <YAxis tickFormatter={tickBytes} {...AXIS} tickLine={false} axisLine={false} width={64} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]?.payload as { sent: number; received: number; total: number };
            const hh = String(label).padStart(2, '0');
            return (
              <TooltipShell label={`${hh}:00 - ${hh}:59`}>
                <div style={{ color: 'var(--accent-bright)', fontSize: 17, fontWeight: 650 }}>
                  {formatBytes(p.total)}
                </div>
                <div style={{ color: '#d4d4d8', marginTop: 5, display: 'grid', gap: 2 }}>
                  <span>
                    <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: DOWN_COLOR, marginRight: 6 }} />
                    Down {formatBytes(p.received)}
                  </span>
                  <span>
                    <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: UP_COLOR, marginRight: 6 }} />
                    Up {formatBytes(p.sent)}
                  </span>
                </div>
              </TooltipShell>
            );
          }}
        />
        {/*
          Stacked, download first so it sits at the base of the column. Download
          takes the darker shade and upload the lighter one, which matches the
          data: on this machine download is the larger half almost everywhere,
          so the heavier colour carries the heavier quantity.

          The peak hour keeps full opacity while the rest are dimmed, so the
          busiest hour still reads at a glance the way it did as a single bar.
        */}
        <Bar dataKey="received" stackId="io" animationDuration={800} animationEasing="ease-out">
          {data.map((d) => (
            <Cell key={d.hour} fill={DOWN_COLOR} fillOpacity={d.total === peak ? 1 : 0.62} />
          ))}
        </Bar>
        <Bar dataKey="sent" stackId="io" radius={[5, 5, 0, 0]} animationDuration={800} animationEasing="ease-out">
          {data.map((d) => (
            <Cell key={d.hour} fill={UP_COLOR} fillOpacity={d.total === peak ? 1 : 0.62} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </ChartFigure>
  );
}

/* ------------------------------------------------------- app detail chart */

/** Daily sent/received for one app, stacked on the same up/down convention. */
export function AppDailyChart({
  data,
}: {
  data: DailyPoint[];
}) {
  return (
    <ChartFigure
      label="Daily usage for this app"
      summary={dailySummary(data, 'Daily usage for this app')}
    >
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={(v) => formatDayShort(String(v))} {...AXIS} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tickFormatter={tickBytes} {...AXIS} tickLine={false} axisLine={false} width={64} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]?.payload as DailyPoint;
            if (p.total === null) {
              return <TooltipShell label={formatDayShort(String(label))}><NoDataNote /></TooltipShell>;
            }
            return (
              <TooltipShell label={formatDayShort(String(label))}>
                <div style={{ color: 'var(--accent-bright)', fontSize: 17, fontWeight: 650 }}>
                  {formatBytes(p.total)}
                </div>
                <div style={{ color: '#a1a1aa', marginTop: 4 }}>
                  &darr; {formatBytes(p.received ?? 0)} &nbsp; &uarr; {formatBytes(p.sent ?? 0)}
                </div>
              </TooltipShell>
            );
          }}
        />
        <Bar dataKey="received" stackId="io" fill={DOWN_COLOR} animationDuration={800} animationEasing="ease-out" />
        <Bar dataKey="sent" stackId="io" fill={UP_COLOR} radius={[4, 4, 0, 0]} animationDuration={800} animationEasing="ease-out" />
      </BarChart>
    </ResponsiveContainer>
    </ChartFigure>
  );
}
