import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonTable,
} from '@/components/Skeleton';

/**
 * By App skeleton.
 *   page head 64 / 73 -> 68
 *   Top 10   566 / 566 -> 566 (content 439)
 *   Apps     title 79 / 55 -> 67; header 44; rows 53 at both widths
 *
 * Re-measured 2026-09-22 with the sidebar expanded.
 *
 * The table is a deliberate departure. The real card measures ~3,300px,
 * because it lists every app ever seen. Reproducing that height would mean a
 * page-long shimmer to prevent shift that happens entirely below the fold,
 * where nothing is visible to shift. Eleven rows covers the first viewport at
 * both widths, which is the part that can actually jump.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      <SkeletonCard contentHeight={439} />
      <SkeletonGap />
      {/* Two-line sub at 997px, one at 1680px: 79 / 55 -> 67. */}
      <SkeletonCard contentHeight={0} titleHeight={67}>
        <SkeletonTable rows={11} columns={6} />
      </SkeletonCard>
    </>
  );
}
