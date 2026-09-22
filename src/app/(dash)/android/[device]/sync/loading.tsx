import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonStatGrid, SkeletonTable,
} from '@/components/Skeleton';

/**
 * Android sync skeleton. Re-measured 2026-09-22 at 997 / 1680, sidebar
 * expanded.
 *
 *   page head       89 /  73 -> 81  (the sub wraps to two lines at 997, on
 *                                    every phone measured: longSub)
 *   score grid     338 / 147
 *   Upload history 1666 / 1642      -- a departure, see below
 *     title        151 / 126 -> 139 (a long sub, wrapping further at 997)
 *     row           56 /  56 -> 56  (the status badge sets it)
 *   How this differs 435 / 333 -> 384
 *
 * **The upload table is a deliberate departure.** It grows with every upload up
 * to a 25-row cap, so no fixed height matches it for long. Seven rows covers
 * the first viewport, which is the only part that can visibly jump.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead longSub />
      {/* valueHeight solved for mirrored error: -9 @997, +8 @1680. */}
      <SkeletonStatGrid columns={3} valueHeight={51} />
      <SkeletonCard contentHeight={0} titleHeight={139}>
        <SkeletonTable rows={7} columns={5} rowHeight={56} />
      </SkeletonCard>
      <SkeletonGap />
      <SkeletonCard contentHeight={258} />
    </>
  );
}
