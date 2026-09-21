import {
  SkeletonPageHead, SkeletonCard, SkeletonStatGrid, SkeletonTable,
} from '@/components/Skeleton';

/**
 * Sync Status skeleton. Re-measured 2026-08-26 at 997 / 1680, sidebar expanded.
 *
 *   page head    89 /  73        (the sub wraps to two lines at 997; the shared
 *                                 68px head stays, because a variant per page
 *                                 is more drift than the 13px it would save)
 *   score grid  311 / 147        (three-up, 1.9rem values, wraps at 997)
 *   Run history 3073 / 1828      -- a departure, see below
 *
 * The run-history table is a deliberate departure, like By App's. Pagination
 * bounds it at 25 rows, but it varies from 1 to 25 depending on how many runs
 * exist, so no fixed number is right for long. Ten rows at the measured 55px
 * (a run row is taller than an app row because of the status badge) covers the
 * first screenful, which is the only part that can visibly jump.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      {/* valueHeight solved for mirrored error, as on the other pages. */}
      <SkeletonStatGrid valueHeight={51} />
      <SkeletonCard contentHeight={0}>
        <SkeletonTable rows={10} columns={7} rowHeight={55} />
      </SkeletonCard>
    </>
  );
}
