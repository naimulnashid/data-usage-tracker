import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonStatGrid,
} from '@/components/Skeleton';

/**
 * Android app detail skeleton. Measured at 997 / 1680, sidebar expanded.
 *
 *   page head    106 / 116 -> 111  (carries a back link, hence backLink)
 *   score grid   336 / 147
 *   Daily usage  490 / 425 -> 458
 *   Hour of day  370 / 345 -> 358
 *   By network   275 / 275 -> 275
 *   Package      251 / 223 -> 237
 *
 * By network and Package are reproduced because in practice every app has
 * both: a uid that moved bytes moved them on some network, and it has at least
 * one package unless it is one of the unmapped system uids.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead backLink />
      {/* valueHeight solved for mirrored error: -8 @997, +8 @1680. */}
      <SkeletonStatGrid columns={4} valueHeight={51} />
      <SkeletonCard contentHeight={332} />
      <SkeletonGap />
      <SkeletonCard contentHeight={232} />
      <SkeletonGap />
      <SkeletonCard contentHeight={149} />
      <SkeletonGap />
      <SkeletonCard contentHeight={111} />
    </>
  );
}
