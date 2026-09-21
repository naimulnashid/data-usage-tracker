import { SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonTable } from '@/components/Skeleton';

/**
 * Android By App skeleton. Measured at 997 / 1680, sidebar expanded.
 *
 *   page head   64 /  73 -> 68
 *   Top 10     565 / 565 -> 565   (contentHeight 439)
 *   Apps table 1586 / 1561        -- see below
 *
 * **The table is a deliberate departure**, like By App on the Windows side.
 * The real card is ~1,600px because it lists 25 apps and expands to 125, and no
 * fixed height matches that for long. Fourteen rows covers the first viewport,
 * which is the only part that can visibly jump.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      <SkeletonCard contentHeight={439} />
      <SkeletonGap />
      <SkeletonCard contentHeight={0}>
        <SkeletonTable rows={14} />
      </SkeletonCard>
    </>
  );
}
