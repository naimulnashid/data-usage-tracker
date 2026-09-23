/**
 * Loading skeletons.
 *
 * These are not decorative grey boxes. Their job is that **nothing moves when
 * the data lands** -- so they reproduce each page section by section, in order,
 * at measured heights.
 *
 * Three rules keep them honest:
 *
 * 1. **Reuse the real classes.** `SkeletonCard` renders an actual `.card` with
 *    an actual title block, so padding, border and title spacing come from the
 *    same CSS the real page uses and cannot drift. Only the content area needs
 *    a number.
 * 2. **Grids use the real class and the real cell count** (`grid grid--3` with
 *    three children), so `auto-fit` wraps them exactly as the real grid does at
 *    every width. A hand-tuned cell count matches at one window size and is
 *    wrong at every other.
 * 3. **Width-sensitive heights carry the mid-range of two measurements**, at
 *    997px and 1680px viewport, so the error is split rather than piled on one
 *    end. Every number in the loading files is annotated with both.
 *
 * Re-measure if a panel changes shape: every real page and every skeleton at
 * both widths, reading `.container > *` heights, with the sidebar expanded.
 * Measure a skeleton through a temporary route that renders its `loading.tsx`
 * on its own. In place it cannot be caught: a cold load paints the ancestor
 * segment's skeleton, and a client-side navigation is too quick for it to
 * paint at all.
 *
 * Unlike the sibling AI Usage Tracker, whose skeleton covers a client-side
 * fetch, these are Next `loading.tsx` boundaries: they show while the server
 * component renders and during route transitions. Same purpose, different
 * mechanism -- which is why they live next to the pages rather than inside a
 * provider.
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

/**
 * Mirrors `page-head`: an h1 and one line of sub text.
 *
 * Measured 64px @997 / 73px @1680 -> 68.
 *
 * `backLink` is for the detail pages, whose head carries a "back" line above
 * the title. Without it those pages start 43px short and every card below them
 * jumps on load. It measures 107 / 117 when the sub line carries a badge --
 * every phone app (its uid), and Windows store apps and services -- and
 * 101 / 111 when it does not, a Windows exe. 111 is within 10px of all four,
 * and a per-kind variant would need the data the skeleton is standing in for.
 *
 * `longSub` is for a head whose sub is a sentence rather than a figure line --
 * both Sync Status pages. It wraps to two lines at 997 and not at 1680:
 * measured 89 / 73 -> 81, on every device measured. On the shared 68 those
 * pages started 21px short at 997, in the first viewport.
 */
export function SkeletonPageHead({
  backLink = false, longSub = false,
}: { backLink?: boolean; longSub?: boolean } = {}) {
  return (
    <div style={{ height: backLink ? 111 : longSub ? 81 : 68, marginBottom: '2.2rem' }}>
      {/* Every loading.tsx opens with this, so this is where a screen reader
          learns the page is loading; the shimmer boxes themselves are empty
          and say nothing. .sr-only is absolutely positioned, so the measured
          height above is untouched. */}
      <span className="sr-only" role="status">Loading</span>
      {backLink && <Skeleton height={14} width={110} style={{ marginBottom: 12 }} />}
      <Skeleton height={30} width={190} />
      <Skeleton height={17} width={330} style={{ marginTop: 10 }} />
      {longSub && <Skeleton height={17} width={210} style={{ marginTop: 6 }} />}
    </div>
  );
}

/**
 * Mirrors `Card` + `CardTitle`.
 *
 * `titleHeight` defaults to 55px, which is what a one-line title with a
 * one-line sub measures at both widths. The 1.15rem bottom margin matches
 * `CardTitle`'s exactly.
 */
export function SkeletonCard({
  contentHeight,
  titleHeight = 55,
  children,
}: {
  contentHeight: number;
  titleHeight?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="card">
      <div style={{ height: titleHeight, marginBottom: '1.15rem' }}>
        <Skeleton height={24} width={160} />
        <Skeleton height={17} width="60%" style={{ marginTop: 7 }} />
      </div>
      {children ?? <Skeleton height={contentHeight} />}
    </div>
  );
}

/**
 * The expanded heat map page, laptop and phone alike: a back-linked head and
 * one card.
 *
 * Without its own `loading.tsx` a navigation there paints the overview's
 * skeleton, because `[device]/loading.tsx` wraps the child segment too.
 *
 * The card grows a block every six months, and a `loading.tsx` is not given
 * the route's data, so it is sized to TWO blocks -- what the page draws from
 * July 2026 to the end of the year. More than that sits below the first
 * viewport, where nothing visible can jump.
 */
export function SkeletonActivityPage() {
  return (
    <>
      <SkeletonPageHead backLink />
      {/* Card measured 640 / 898 at 997 / 1680 (two blocks), mid 769. */}
      <SkeletonCard contentHeight={642} />
    </>
  );
}

/** The 1.15rem spacer the real pages put between cards. */
export function SkeletonGap() {
  return <div style={{ height: '1.15rem' }} />;
}

/**
 * Mirrors a `.grid.grid--3` of stat cards.
 *
 * Uses the real grid class and a real three-card count, so it wraps identically
 * at every width -- which is why no height is passed for the grid itself.
 */
export function SkeletonStatGrid({
  valueHeight = 80,
  columns = 3,
}: {
  valueHeight?: number;
  columns?: 3 | 4;
}) {
  return (
    <div className={`grid grid--${columns}`} style={{ marginBottom: '1.15rem' }}>
      {Array.from({ length: columns }, (_, i) => (
        <div className="card" key={i}>
          <Skeleton height={13} width={92} />
          <Skeleton height={valueHeight} width="72%" style={{ marginTop: 12 }} />
          <Skeleton height={16} width="55%" style={{ marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
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
