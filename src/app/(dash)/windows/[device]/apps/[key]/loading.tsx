import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonStatGrid,
} from '@/components/Skeleton';

/**
 * App detail skeleton. Re-measured 2026-09-22 at 997 / 1680, sidebar expanded,
 * across every app that has a detail page.
 *
 *   page head    101 / 111, or 107 / 117 with a badge -> 111 (see backLink)
 *   score grid   338 / 147
 *   Daily usage  491 / 426 -> 458
 *   Hour of day  346 / 346 -> 346
 *   By network   464 / 436 -> 450 (median; 224 for an app seen on one network)
 *
 * By network is reproduced because every app has it: it was on every page
 * measured, since an app with rows moved them on some network profile.
 *
 * The cards below it - Merged apps and Grouped from - are NOT. Both are
 * conditional, "Grouped from" alone ranges from 277px to 9,719px, and a
 * skeleton that promises cards an app may not have is a worse kind of wrong
 * than one that stops short.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead backLink />
      {/* valueHeight solved for mirrored error: -9 @997, +8 @1680. */}
      <SkeletonStatGrid columns={4} valueHeight={51} />
      <SkeletonCard contentHeight={332} />
      <SkeletonGap />
      <SkeletonCard contentHeight={219} />
      <SkeletonGap />
      <SkeletonCard contentHeight={324} />
    </>
  );
}
