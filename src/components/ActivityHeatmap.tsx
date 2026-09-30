'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { formatBytes, formatDayLong, formatDayShort } from '@/lib/format';
import { HEATMAP_RAMP, heatmapColor } from '@/lib/app-colors';
import {
  WEEKS, DAY_LABELS, recentBlock, expandedBlocks, blockLabel,
  type HeatmapBlock, type HeatmapDay,
} from '@/lib/heatmap';

export type { HeatmapDay } from '@/lib/heatmap';

/** Keep in step with `WEEKS` in `lib/heatmap.ts`. */
const RANGE_LABEL = '6 months';

/**
 * One block of the heat map, GitHub-style, coloured with the accent ramp.
 *
 * Month labels, weekday labels and cells all live in ONE grid with explicit
 * placement. That is what keeps the three registered with each other: the cells
 * size themselves from the shared column tracks, and the weekday labels inherit
 * the same row heights, so nothing can drift out of alignment.
 *
 * Cells are fluid (`1fr` columns plus `aspect-ratio: 1`) rather than a fixed
 * pixel size, so the grid fills whatever width the panel has and stays square
 * at any width.
 *
 * Cells use native `title` tooltips deliberately. A styled, absolutely
 * positioned tooltip inside this grid would contribute layout width to the
 * scroll container even while hidden, which produces a phantom horizontal
 * scrollbar.
 *
 * Days with no row at all are drawn as "no data" rather than as a zero. Before
 * collection started there is genuinely nothing to report, and colouring that
 * the same as a real quiet day would invent history the project does not have.
 *
 * `max` is passed in rather than taken from the block so that the expanded
 * page's blocks share one scale: a block's colours must mean the same bytes as
 * the block above it.
 */
function HeatmapPlot({ block, max, label }: { block: HeatmapBlock; max: number; label: string }) {
  return (
    <div className="heatmap-scroll">
      <div
        className="heatmap-plot"
        role="img"
        aria-label={label}
        style={{
          gridTemplateColumns: `var(--hm-daycol) repeat(${WEEKS}, minmax(var(--hm-min), 1fr))`,
        }}
      >
        {block.months.map((mark) => (
          <span
            key={`${mark.label}-${mark.column}`}
            className="heatmap-month"
            style={{ gridColumn: mark.column + 2, gridRow: 1 }}
            aria-hidden
          >
            {mark.label}
          </span>
        ))}

        {DAY_LABELS.map((day, i) => (
          <span
            key={day}
            className="heatmap-day"
            style={{ gridColumn: 1, gridRow: i + 2 }}
            aria-hidden
          >
            {day}
          </span>
        ))}

        {block.cells.map((cell) => {
          const title = cell.hidden
            ? ''
            : cell.known
              ? `${formatDayLong(cell.date)} - ${formatBytes(cell.total)}`
              : `${formatDayLong(cell.date)} - no data collected`;
          return (
            <span
              key={cell.date}
              className="heatmap-cell"
              data-nodata={!cell.hidden && !cell.known}
              title={title}
              style={{
                gridColumn: cell.column + 2,
                gridRow: cell.row + 2,
                background: cell.hidden
                  ? 'transparent'
                  : cell.known
                    ? heatmapColor(cell.total, max)
                    : 'var(--hm-none)',
                visibility: cell.hidden ? 'hidden' : 'visible',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Summary on the left, colour scale on the right. `children`, when given, sits
 * centred between them -- the overview puts its Expand button there.
 */
function HeatmapLegend({
  total, activeDays, span, children,
}: {
  total: number;
  activeDays: number;
  span: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`heatmap-legend${children ? ' heatmap-legend--split' : ''}`}>
      <span className="heatmap-summary">
        {formatBytes(total)} across {activeDays} active {activeDays === 1 ? 'day' : 'days'} {span}
      </span>
      {children && <span className="heatmap-legend-middle">{children}</span>}
      <span className="heatmap-scale">
        Less
        {HEATMAP_RAMP.map((color) => (
          <span key={color} className="heatmap-swatch" style={{ background: color }} />
        ))}
        More
      </span>
    </div>
  );
}

/**
 * The overview card: the last `RANGE_LABEL`.
 *
 * `expandHref` offers the full-history page. The button is always there when
 * a link is given (since 2026-09-30, at the user's request). It used to appear
 * only once the data reached back further than this block, on the reasoning
 * that the expanded page would otherwise show nothing new -- but a control
 * that is missing until some date is one nobody knows to look for.
 */
export function ActivityHeatmap({
  daily, expandHref,
}: {
  daily: HeatmapDay[];
  expandHref?: string;
}) {
  const block = useMemo(() => recentBlock(daily), [daily]);

  return (
    <div className="heatmap">
      <HeatmapPlot
        block={block}
        max={block.peak}
        label={`Daily data usage over the last ${RANGE_LABEL}`}
      />
      <HeatmapLegend
        total={block.total}
        activeDays={block.activeDays}
        span={`in the last ${RANGE_LABEL}`}
      >
        {expandHref && <Link href={expandHref} className="chip">Expand</Link>}
      </HeatmapLegend>
    </div>
  );
}

/**
 * The full history, as blocks of the overview's width stacked oldest first.
 *
 * Growing downward rather than sideways is the point: every block has the
 * overview's `WEEKS` columns, so cells stay the size they are there, however
 * many years accumulate.
 */
export function ExpandedHeatmap({
  daily, earliest,
}: {
  daily: HeatmapDay[];
  earliest: string | null;
}) {
  const { blocks, max, total, activeDays } = useMemo(() => {
    const all = expandedBlocks(daily, earliest);
    return {
      blocks: all,
      max: Math.max(0, ...all.map((b) => b.peak)),
      total: all.reduce((s, b) => s + b.total, 0),
      activeDays: all.reduce((s, b) => s + b.activeDays, 0),
    };
  }, [daily, earliest]);

  return (
    <div>
      {blocks.map((block) => {
        const label = blockLabel(block);
        return (
          <section key={block.first} className="heatmap-block">
            <h3 className="heatmap-block-head">
              <span>{label}</span>
              <span className="heatmap-block-total">{formatBytes(block.total)}</span>
            </h3>
            <HeatmapPlot block={block} max={max} label={`Daily data usage, ${label}`} />
          </section>
        );
      })}
      <HeatmapLegend
        total={total}
        activeDays={activeDays}
        span={blocks[0] ? `since ${formatDayShort(blocks[0].first)}, ${blocks[0].first.slice(0, 4)}` : ''}
      />
    </div>
  );
}
