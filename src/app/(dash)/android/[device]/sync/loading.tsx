import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonStatGrid, SkeletonTable,
} from '@/components/Skeleton';

/**
 * Android sync skeleton. Measured at 997 / 1680, sidebar expanded.
 *
 *   page head       89 /  73        (the sub wraps to two lines at 997; the
 *                                    shared head is 68 and stays, because a
 *                                    variant per page is more drift than the
 *                                    13px it would save)
 *   score grid     336 / 147
 *   Upload history 651 / 627        -- a departure, see below
 *   How this differs 435 / 358 -> 397
 *
 * **The upload table is a deliberate departure.** It grows with every upload up
 * to a 25-row cap, so no fixed height matches it for long. Eleven rows covers
 * the first viewport, which is the only part that can visibly jump.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      <SkeletonStatGrid columns={3} valueHeight={51} />
      <SkeletonCard contentHeight={0}>
        <SkeletonTable rows={11} columns={5} />
      </SkeletonCard>
      <SkeletonGap />
      <SkeletonCard contentHeight={271} />
    </>
  );
}
