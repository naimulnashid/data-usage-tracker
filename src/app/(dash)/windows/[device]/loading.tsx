import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonStatGrid,
} from '@/components/Skeleton';
import { splitAppName } from '@/lib/queries';

/**
 * Overview skeleton, re-measured 2026-08-26 at 997px and 1680px with the
 * sidebar EXPANDED. Each height below is the mid-range of the two.
 *
 *   page head    64 /  73 -> 68
 *   score grid  349 / 191        (four-up; wraps to 2x2 at 997, and the value
 *                                 font is a vw clamp, so rows are shorter there)
 *   Trend       425 / 425 -> 425
 *   Activity    379 / 496 -> 438 (heat-map cells are fluid)
 *   Daily by app 579 / 546 -> 563 (the legend wraps to more rows at 997)
 *   Hour of day 345 / 345 -> 345
 *   Split       386 / 280 -> 333 (its inner grid--2 wraps at 997); drawn only
 *                                 when `splitApp` is configured, like the card
 *
 * The previous numbers here predated the sidebar. Adding a 232px rail changed
 * the container width at every viewport, so every width-sensitive height moved
 * and the recorded errors were stale rather than merely imprecise. Measure with
 * the sidebar EXPANDED; collapsed it is 62px and the numbers differ again.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      {/* valueHeight solved so the error is mirrored: +16 @997, -17 @1680. */}
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
          <SkeletonCard contentHeight={207} />
        </>
      )}
    </>
  );
}
