import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonStatGrid,
} from '@/components/Skeleton';

/**
 * Android overview skeleton, re-measured 2026-09-22 section by section against
 * the real page at 997px and 1680px viewport, sidebar EXPANDED. Each height is
 * the mid-range.
 *
 *   page head       64 /  73 -> 68
 *   score grid     350 / 192        (four-up; wraps to 2x2 at 997, and the
 *                                    value font is a vw clamp, so the rows are
 *                                    genuinely shorter there)
 *   Trend          426 / 426 -> 426
 *   Activity       380 / 497 -> 438 (heat-map cells are fluid)
 *   Daily by app   580 / 547 -> 563 (the legend wraps to more rows at 997)
 *   Hour of day    371 / 346 -> 358
 *   Where it went 1234 / 1108 -> 1171 (its inner grid--2 wraps at 997)
 *   Tethering      228 / 177 -> 203
 *
 * Card height is contentHeight + 126.6, so each number below is mid-range less
 * that. Whole page, skeleton minus real: -38px @997, +36px @1680.
 *
 * **Measured on the phone `/android` opens** -- the one with the most data --
 * because a loading boundary is not given the device and cannot size itself to
 * it. Two sections differ between phones, both far below the fold:
 *
 * - "Where it went" carries a row per Wi-Fi network in the USB capture, so it
 *   grows with that list. A phone with two networks measures 622 / 496.
 * - Tethering appears only on a phone that tethered in the range.
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
      {/* valueHeight solved so the error is mirrored: +17 @997, -18 @1680. */}
      <SkeletonStatGrid columns={4} valueHeight={70} />
      <SkeletonCard contentHeight={299} />
      <SkeletonGap />
      <SkeletonCard contentHeight={312} />
      <SkeletonGap />
      <SkeletonCard contentHeight={437} />
      <SkeletonGap />
      <SkeletonCard contentHeight={232} />
      <SkeletonGap />
      <SkeletonCard contentHeight={1044} />
      <SkeletonGap />
      <SkeletonCard contentHeight={76} />
    </>
  );
}
