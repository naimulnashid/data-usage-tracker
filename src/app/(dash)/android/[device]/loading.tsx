import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonStatGrid,
} from '@/components/Skeleton';

/**
 * Android overview skeleton, measured section by section against the real page
 * at 997px and 1680px viewport, sidebar EXPANDED. Each height is the mid-range.
 *
 *   page head       64 /  73 -> 68
 *   score grid     349 / 191        (four-up; wraps to 2x2 at 997, and the
 *                                    value font is a vw clamp, so the rows are
 *                                    genuinely shorter there)
 *   Trend          425 / 425 -> 425
 *   Activity       379 / 496 -> 438 (heat-map cells are fluid)
 *   Daily by app   579 / 546 -> 563 (the legend wraps to more rows at 997)
 *   Hour of day    370 / 345 -> 358
 *   Where it went  383 / 277 -> 330 (its inner grid--2 wraps at 997)
 *   Tethering      227 / 202 -> 215
 *
 * Card height is contentHeight + 126, so each number below is mid-range - 126.
 *
 * NOTE: measure with the sidebar EXPANDED. It is 232px against 62px collapsed,
 * which changes the container width and therefore every width-sensitive height
 * on the page. An earlier pass mixed the two states and produced numbers that
 * were wrong at both widths.
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
      <SkeletonCard contentHeight={232} />
      <SkeletonGap />
      <SkeletonCard contentHeight={204} />
      <SkeletonGap />
      <SkeletonCard contentHeight={89} />
    </>
  );
}
