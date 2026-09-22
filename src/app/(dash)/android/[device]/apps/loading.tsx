import { SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonTable } from '@/components/Skeleton';

/**
 * Android By App skeleton. Re-measured 2026-09-22 at 997 / 1680, sidebar
 * expanded.
 *
 *   page head   64 /  73 -> 68
 *   Top 10     566 / 566 -> 566   (contentHeight 439)
 *   Apps table 1595 / 1570        -- see below
 *     title     79 /  55 -> 67; header 44; rows 53 at both widths
 *
 * **The table is a deliberate departure**, like By App on the Windows side.
 * The real card is ~1,600px because it lists 25 apps and expands to 125, and no
 * fixed height matches that for long. Eleven rows covers the first viewport,
 * which is the only part that can visibly jump.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      <SkeletonCard contentHeight={439} />
      <SkeletonGap />
      {/* Two-line sub at 997px, one at 1680px: 79 / 55 -> 67. */}
      <SkeletonCard contentHeight={0} titleHeight={67}>
        <SkeletonTable rows={11} />
      </SkeletonCard>
    </>
  );
}
