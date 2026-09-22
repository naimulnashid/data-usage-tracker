import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonStatGrid,
} from '@/components/Skeleton';
import { splitAppName } from '@/lib/queries';

/**
 * Overview skeleton, re-measured 2026-09-22 at 997px and 1680px with the
 * sidebar EXPANDED. Each height below is the mid-range of the two.
 *
 *   page head    64 /  73 -> 68
 *   score grid  350 / 192        (four-up; wraps to 2x2 at 997, and the value
 *                                 font is a vw clamp, so rows are shorter there)
 *   Trend       426 / 426 -> 426
 *   Activity    380 / 497 -> 438 (heat-map cells are fluid)
 *   Daily by app 580 / 547 -> 563 (the legend wraps to more rows at 997)
 *   Hour of day 346 / 346 -> 346
 *   Split       411 / 281 -> 346 (its inner grid--2 wraps at 997, and so does
 *                                 its title's sub); drawn only when `splitApp`
 *                                 is configured, like the card
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
      <SkeletonCard contentHeight={312} />
      <SkeletonGap />
      <SkeletonCard contentHeight={437} />
      <SkeletonGap />
      <SkeletonCard contentHeight={219} />
      {splitAppName() && (
        <>
          <SkeletonGap />
          <SkeletonCard contentHeight={220} />
        </>
      )}
    </>
  );
}
