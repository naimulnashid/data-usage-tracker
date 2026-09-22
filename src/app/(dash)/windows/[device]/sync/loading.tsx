import {
  SkeletonPageHead, SkeletonCard, SkeletonStatGrid, SkeletonTable,
} from '@/components/Skeleton';

/**
 * Sync Status skeleton. Re-measured 2026-09-22 at 997 / 1680, sidebar expanded.
 *
 *   page head    89 /  73 -> 81  (the sub wraps to two lines at 997: longSub)
 *   score grid  313 / 147        (three-up, 1.9rem values, wraps at 997)
 *   Run history 3158 / 1929      -- a departure, see below
 *     title     126 / 55  -> 91  (its sub wraps at 997; one line at 1680)
 *     row        56 / 56  -> 56  (the status badge sets it; the date no longer
 *                                 wraps, which made it 99 at 997)
 *
 * The run-history table is a deliberate departure, like By App's. Pagination
 * bounds it at 25 rows, but it varies from 1 to 25 depending on how many runs
 * exist, so no fixed number is right for long. Ten rows covers the first
 * screenful, which is the only part that can visibly jump.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead longSub />
      {/* Every card is 147 at both widths, so there is no error to mirror:
          43 makes the skeleton's card exactly that. */}
      <SkeletonStatGrid valueHeight={43} />
      <SkeletonCard contentHeight={0} titleHeight={91}>
        <SkeletonTable rows={10} columns={7} rowHeight={56} />
      </SkeletonCard>
    </>
  );
}
