import {
  SkeletonPageHead, SkeletonCard, SkeletonGap, SkeletonStatGrid,
} from '@/components/Skeleton';

/**
 * App detail skeleton. Re-measured 2026-08-26 at 997 / 1680, sidebar expanded.
 *
 *   page head    106 / 116 -> 111  (carries a back link, hence backLink)
 *   score grid   336 / 147
 *   Daily usage  490 / 425 -> 458
 *   Hour of day  345 / 345 -> 345
 *
 * The cards below those - By network, Merged apps, Grouped from - are NOT
 * reproduced. All three are conditional, "Grouped from" alone measures 2,015px
 * on a family like Claude, and a skeleton that promises cards an app may not
 * have is a worse kind of wrong than one that stops short.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead backLink />
      <SkeletonStatGrid columns={4} valueHeight={51} />
      <SkeletonCard contentHeight={332} />
      <SkeletonGap />
      <SkeletonCard contentHeight={219} />
    </>
  );
}
