/**
 * Loading skeletons.
 *
 * These are not decorative grey boxes. Their job is that **nothing moves when
 * the data lands** -- so they reproduce each page section by section, in order.
 *
 * Since 2026-09-30 they do it by rendering the page's OWN markup (the `Sk*`
 * blocks at the end of this file): real classes, real grids, and the real
 * headings and fixed sentences as invisible shimmering text. They therefore
 * wrap exactly where the page wraps, at every width, and measured to the pixel
 * against the real pages at 997 and 1680. The previous generation carried one
 * measured height per section, the mid-range of those two widths, and so was
 * wrong by half the range at both ends.
 *
 * What is still a stand-in is only what depends on the data -- figures, a
 * legend's app names, a list's length -- and the long list tables, which are
 * deliberate departures (see each loading.tsx).
 *
 * Re-measure after a panel changes shape: a temporary route that renders each
 * `loading.tsx` on its own, compared section by section with the real page,
 * sidebar expanded. In place a skeleton cannot be caught: a cold load paints
 * the ancestor segment's skeleton, and a client-side navigation is too quick
 * for it to paint at all.
 *
 * Unlike the sibling AI Usage Tracker, whose skeleton covers a client-side
 * fetch, these are Next `loading.tsx` boundaries: they show while the server
 * component renders and during route transitions.
 */

/** One shimmering block. */
export function Skeleton({
  height,
  width = '100%',
  radius,
  style,
}: {
  height: number | string;
  width?: number | string;
  radius?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="skeleton"
      style={{ height, width, ...(radius ? { borderRadius: radius } : {}), ...style }}
    />
  );
}

/** The 1.15rem spacer the real pages put between cards. */
export function SkeletonGap() {
  return <div style={{ height: '1.15rem' }} />;
}

/**
 * Mirrors a table: a 44px header row plus `rows` body rows.
 *
 * `rowHeight` is measured, not guessed. The 53px default is an app row, which
 * its logo sets; a Sync Status row carries a status badge and is 56px. The old
 * 42px default predated the logos and left By App 11px short per row.
 */
export function SkeletonTable({
  rows, columns = 6, rowHeight = 53,
}: {
  rows: number;
  columns?: number;
  rowHeight?: number;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: '0.9rem',
          alignItems: 'center',
          height: 44,
          padding: '0 0.9rem',
          boxSizing: 'border-box',
        }}
      >
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} height={14} width={i === 0 ? '26%' : '12%'} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          style={{
            display: 'flex',
            gap: '0.9rem',
            alignItems: 'center',
            height: rowHeight,
            padding: '0 0.9rem',
            borderTop: '1px solid var(--border)',
            boxSizing: 'border-box',
          }}
        >
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={i} height={17} width={i === 0 ? '26%' : '12%'} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ======================================================================
   SHAPE-ACCURATE SKELETONS (2026-09-30)

   The blocks above size a section with ONE measured number, the mid-range of
   two widths, so every width-sensitive section was wrong by half its range at
   both ends: the overview's skeleton was 77px short at 997 and 73px long at
   1680, all of it in sections that reflow.

   These instead render the page's OWN markup -- the real classes, the real
   grids, and the real headings and fixed sentences as invisible shimmering
   text -- so they wrap exactly where the page wraps, at every width. A
   heading is a real <h2> with the heading's own words in it; a score card is
   a real .stat-value at the real font size; the heat map is the real grid of
   fluid square cells. Only what depends on the data -- a legend's app names,
   a list's length -- is a stand-in, sized to what the page usually shows.
   ====================================================================== */

/** Text laid out exactly as the real text, painted as a shimmer bar per line. */
export function SkText({ children }: { children: React.ReactNode }) {
  return <span className="skeleton sk-text">{children}</span>;
}

/** Real markup, shown as one shimmering block: for paragraphs and lists. */
export function SkMask({ children }: { children: React.ReactNode }) {
  return <div className="sk-mask" aria-hidden>{children}</div>;
}

/** `.page-head`, laid out from its real text. */
export function SkPageHead({
  title, sub, back, badge, appTitle = false,
}: {
  title: string;
  sub: string;
  /** The "back" link above a detail page's title. */
  back?: string;
  /** A badge leading the sub line (a phone app's uid). */
  badge?: string;
  /** A detail page's title row: logo, name, rename pencil. */
  appTitle?: boolean;
}) {
  return (
    <div className="page-head">
      <span className="sr-only" role="status">Loading</span>
      {back && <span className="back-link"><SkText>&larr; {back}</SkText></span>}
      {appTitle ? (
        <h1 className="app-title">
          <span className="skeleton" style={{ width: '1.1em', height: '1.1em', flexShrink: 0, borderRadius: 4 }} />
          <SkText>{title}</SkText>
          <span style={{ width: 32, height: 32, flexShrink: 0 }} />
        </h1>
      ) : (
        <h1 style={back ? { marginTop: '0.6rem' } : undefined}><SkText>{title}</SkText></h1>
      )}
      <p>
        {badge && (
          <span className="badge" style={{ marginRight: '0.6rem', borderColor: 'transparent' }}>
            <SkText>{badge}</SkText>
          </span>
        )}
        <SkText>{sub}</SkText>
      </p>
    </div>
  );
}

/** `Card` + `CardTitle`, with the real title and sub. */
export function SkCard({
  title, sub, aside, children,
}: {
  title: string;
  sub?: string;
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-title">
        <div style={{ minWidth: 0 }}>
          <h2><SkText>{title}</SkText></h2>
          {sub && <p style={{ margin: '0.3rem 0 0', fontSize: 'var(--fs-small)' }}><SkText>{sub}</SkText></p>}
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** The right-hand figure in a card title: "Heaviest day", "Busiest hour". */
export function SkCallout({ label, date, value }: { label: string; date: string; value: string }) {
  return (
    <div className="callout">
      <div className="callout-head">
        <span className="callout-label"><SkText>{label}</SkText></span>
        <span className="callout-date"><SkText>{date}</SkText></span>
      </div>
      <div className="callout-value"><SkText>{value}</SkText></div>
    </div>
  );
}

/**
 * One score card. `size` picks the value font: 'hero' is the overview's
 * `--fs-stat` (a vw clamp, which is why a fixed-height skeleton could never
 * match it at two widths), 'small' the 1.9rem the detail and sync pages use.
 */
export function SkStat({
  label, value, unit, size = 'hero', io, sub, range,
}: {
  label: string;
  value: string;
  unit?: string;
  size?: 'hero' | 'small';
  io?: [string, string];
  sub?: string;
  range?: string;
}) {
  return (
    <div className="card">
      <div className="stat-label"><SkText>{label}</SkText></div>
      <div className="stat-value" style={{ marginTop: '0.5rem', ...(size === 'small' ? { fontSize: '1.9rem' } : {}) }}>
        <SkText>{value}{unit && <span className="stat-unit">{unit}</span>}</SkText>
      </div>
      {io && (
        <div className="stat-io"><SkText>&uarr; {io[0]}</SkText><SkText>&darr; {io[1]}</SkText></div>
      )}
      {sub && <div className="stat-sub"><SkText>{sub}</SkText></div>}
      {range && <div className="stat-range"><SkText>{range}</SkText></div>}
    </div>
  );
}

/** A score-card grid: the real `.grid--N`, so it wraps where the page does. */
export function SkStats({ columns, children }: { columns: 3 | 4; children: React.ReactNode }) {
  return <div className={`grid grid--${columns}`} style={{ marginBottom: '1.15rem' }}>{children}</div>;
}

/** A chart's plot: its ResponsiveContainer height is fixed in Charts.tsx. */
export function SkPlot({ height }: { height: number }) {
  return <Skeleton height={height} />;
}

/** A centred chart legend. Names are stand-ins; the real ones are data. */
export function SkLegend({ items, logo = false }: { items: string[]; logo?: boolean }) {
  return (
    <div className="legend">
      {items.map((t) => (
        <span className="legend-item" key={t}>
          <span
            className="skeleton"
            style={logo
              ? { width: 15, height: 15, borderRadius: 4, flexShrink: 0 }
              : { width: 11, height: 11, borderRadius: 3, flexShrink: 0 }}
          />
          <SkText>{t}</SkText>
        </span>
      ))}
    </div>
  );
}

/** An hour-of-day chart with its Download / Upload legend. */
export function SkHourly() {
  return (
    <>
      <SkPlot height={220} />
      <SkLegend items={['Download', 'Upload']} />
    </>
  );
}

const HM_WEEKS = 26;

/** One heat-map plot: the real grid, so its square cells size exactly. */
function SkHeatmapPlot() {
  return (
    <div className="heatmap-scroll">
      <div
        className="heatmap-plot"
        style={{ gridTemplateColumns: `var(--hm-daycol) repeat(${HM_WEEKS}, minmax(var(--hm-min), 1fr))` }}
      >
        <span className="heatmap-month" style={{ gridColumn: 2, gridRow: 1 }}><SkText>Apr</SkText></span>
        {['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => (
          <span key={d} className="heatmap-day" style={{ gridColumn: 1, gridRow: i + 2 }}><SkText>{d}</SkText></span>
        ))}
        {Array.from({ length: HM_WEEKS * 7 }, (_, i) => (
          <span
            key={i}
            className="heatmap-cell skeleton"
            style={{ gridColumn: Math.floor(i / 7) + 2, gridRow: (i % 7) + 2, borderRadius: 3 }}
          />
        ))}
      </div>
    </div>
  );
}

function SkHeatmapLegend({ summary, expand }: { summary: string; expand: boolean }) {
  return (
    <div className={`heatmap-legend${expand ? ' heatmap-legend--split' : ''}`}>
      <span className="heatmap-summary"><SkText>{summary}</SkText></span>
      {expand && (
        <span className="heatmap-legend-middle">
          <span className="chip"><SkText>Expand</SkText></span>
        </span>
      )}
      <span className="heatmap-scale">
        <SkText>Less</SkText>
        {Array.from({ length: 6 }, (_, i) => <span key={i} className="heatmap-swatch skeleton" />)}
        <SkText>More</SkText>
      </span>
    </div>
  );
}

/** The overview's Activity card body: 26 weeks and the legend row. */
export function SkHeatmap() {
  return (
    <div className="heatmap">
      <SkHeatmapPlot />
      <SkHeatmapLegend summary="680 GB across 97 active days in the last 6 months" expand />
    </div>
  );
}

/**
 * The expanded heat map page. It grows a block every six months, and a
 * `loading.tsx` is not given the data, so it draws TWO blocks -- what the page
 * shows from July to the end of the year. Anything past that is below the
 * first viewport.
 */
export function SkActivityPage({ device, cardSub }: { device: string; cardSub: string }) {
  return (
    <>
      <SkPageHead back="Overview" title="Activity" sub="Every day held, six months to a row, on one colour scale" />
      <SkCard title={device} sub={cardSub}>
        {['Jan 1 – Jun 26, 2026', 'Jun 27 – Dec 25, 2026'].map((label) => (
          <section key={label} className="heatmap-block">
            <h3 className="heatmap-block-head">
              <span><SkText>{label}</SkText></span>
              <span className="heatmap-block-total"><SkText>651 GB</SkText></span>
            </h3>
            <SkHeatmapPlot />
          </section>
        ))}
        <SkHeatmapLegend summary="681 GB across 97 active days since Jan 1, 2026" expand={false} />
      </SkCard>
    </>
  );
}

/** Halves of a split: a swatch label, a big figure, a share line. */
export function SkHalves({ halves, marginTop = '1.4rem' }: {
  halves: { label: string; value: string; unit?: string; sub: string }[];
  marginTop?: string;
}) {
  return (
    <div className={`grid grid--${Math.min(halves.length, 4)}`} style={{ marginTop }}>
      {halves.map((h) => (
        <div key={h.label}>
          <div className="legend-item" style={{ fontSize: 'var(--fs-small)' }}>
            <span className="skeleton" style={{ width: 11, height: 11, borderRadius: 3, flexShrink: 0 }} />
            <SkText>{h.label}</SkText>
          </div>
          <div className="stat-value" style={{ marginTop: '0.3rem' }}>
            <SkText>{h.value}{h.unit && <span className="stat-unit">{h.unit}</span>}</SkText>
          </div>
          <div className="stat-sub"><SkText>{h.sub}</SkText></div>
        </div>
      ))}
    </div>
  );
}

/** The 16px bar across the top of a split or network card. */
export function SkBar() {
  return <Skeleton height={16} radius="8px" />;
}

/** A network list inside "Where it went" / "By network": head, rows, note. */
export function SkSsidBlock({
  head, note, rows, footnote,
}: {
  head: string;
  note?: string;
  rows: number;
  footnote?: React.ReactNode;
}) {
  return (
    <div className="ssid-block">
      <div className="ssid-head">
        <span><SkText>{head}</SkText></span>
        {note && <span className="ssid-note"><SkText>{note}</SkText></span>}
      </div>
      <table className="ssid-table">
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td className="ssid-name"><SkText>HomeNet-5G</SkText></td>
              <td className="num"><SkText>19.1 GB</SkText></td>
              <td style={{ width: '45%' }}><div className="bar-track skeleton" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* The note's own markup, <p> included: see components/Notes.tsx. */}
      {footnote && <SkMask>{footnote}</SkMask>}
    </div>
  );
}

/**
 * A plain data table in the real table markup: `head` for the header row,
 * `cells` for every body row ('bar' draws a share bar), `rows` of them.
 */
export function SkDataTable({ head, rows, cells, className }: {
  head: string[];
  rows: number;
  cells: string[];
  className?: string;
}) {
  const num = (i: number, n: number) => (i > 0 && i < n - 1 ? 'num' : undefined);
  return (
    <div className="table-wrap">
      <table className={className}>
        <thead>
          <tr>{head.map((h, i) => <th key={h} className={num(i, head.length)}><SkText>{h}</SkText></th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {cells.map((c, i) => (
                <td key={i} className={num(i, cells.length)}>
                  {c === 'bar' ? <div className="bar-track skeleton" /> : <SkText>{c}</SkText>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
