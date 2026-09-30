import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonStatGrid,
} from '@/components/Skeleton';
import { splitAppName } from '@/lib/queries';

/**
 * Overview skeleton, re-measured 2026-09-22 at 997px and 1680px with the
 * sidebar EXPANDED, and the rows marked * again on 2026-09-30. Each height
 * below is the mid-range of the two.
 *
 *   page head    64 /  73 -> 68
 *   score grid  350 / 192        (four-up; wraps to 2x2 at 997, and the value
 *                                 font is a vw clamp, so rows are shorter there)
 *   Trend       426 / 426 -> 426
 *   Activity    405 / 499 -> 452 * (heat-map cells are fluid; Expand is
 *                                    always in the legend row now)
 *   Daily by app 580 / 547 -> 563 (the legend wraps to more rows at 997)
 *   Hour of day 387 / 387 -> 387 * (Download / Upload legend under it)
 *   Split       411 / 281 -> 346 (its inner grid--2 wraps at 997, and so does
 *                                 its title's sub); drawn only when `splitApp`
 *                                 is configured, like the card
 *   Where it went 826 / 700 -> 763 * (the network list, 7 rows here)
 *
 * Card height is contentHeight + 126.6, so each number below is mid-range less
 * that. Whole page, skeleton minus real: -2px @997, +0px @1680.
 *
 * Measure with the sidebar EXPANDED; collapsed it is 62px against 232px, which
 * changes the container width and so every width-sensitive height above.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      {/* valueHeight solved so the error is mirrored: +17 @997, -18 @1680. */}
      <SkeletonStatGrid columns={4} valueHeight={70} />
      <SkeletonCard contentHeight={299} />
      <SkeletonGap />
      <SkeletonCard contentHeight={325} />
      <SkeletonGap />
      <SkeletonCard contentHeight={437} />
      <SkeletonGap />
      <SkeletonCard contentHeight={260} />
      {splitAppName() && (
        <>
          <SkeletonGap />
          <SkeletonCard contentHeight={220} />
        </>
      )}
      <SkeletonGap />
      <SkeletonCard contentHeight={636} />
    </>
  );
}
