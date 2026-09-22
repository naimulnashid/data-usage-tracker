import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonStatGrid,
} from '@/components/Skeleton';

/**
 * Android app detail skeleton. Re-measured 2026-09-22 at 997 / 1680, sidebar
 * expanded, across every app with a detail page on the phone `/android` opens.
 *
 *   page head    107 / 117 -> 111  (carries a back link, hence backLink)
 *   score grid   338 / 147
 *   Daily usage  491 / 426 -> 458
 *   Hour of day  371 / 346 -> 358
 *   By network   888 / 888 -> 888  (median; 480 to 1010)
 *   Package      224 / 224 -> 224  (median)
 *
 * By network and Package are reproduced because in practice every app has
 * both: a uid that moved bytes moved them on some network, and it has at least
 * one package unless it is one of the unmapped system uids.
 *
 * By network is the one that differs by phone. Below its Wi-Fi / mobile table
 * it lists the app's Wi-Fi networks from the USB capture, so it is 345 on a
 * phone whose capture holds two networks and 480 to 1010 on the phone measured
 * here. The card starts ~1,400px down, below the first viewport at
 * either width.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead backLink />
      {/* valueHeight solved for mirrored error: -9 @997, +8 @1680. */}
      <SkeletonStatGrid columns={4} valueHeight={51} />
      <SkeletonCard contentHeight={332} />
      <SkeletonGap />
      <SkeletonCard contentHeight={232} />
      <SkeletonGap />
      <SkeletonCard contentHeight={761} />
      <SkeletonGap />
      <SkeletonCard contentHeight={97} />
    </>
  );
}
