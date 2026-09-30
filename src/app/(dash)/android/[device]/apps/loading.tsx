import {
  SkPageHead, SkCard, SkPlot, SkeletonGap, SkeletonTable,
} from '@/components/Skeleton';

/**
 * Android By App skeleton, shape-accurate since 2026-09-30
 * (components/Skeleton.tsx): the real headings, and the Top 10 plot at its
 * real height, ten 44px rows.
 *
 * **The table is a deliberate departure**, like By App on the Windows side.
 * The real card lists 25 apps and expands to every uid, and no fixed height
 * matches that for long. Eleven rows of the measured 53px covers the first
 * viewport, the only part that can visibly jump.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead title="By App" sub="48 apps · 113 GB attributed · 931 MB of tethering excluded (0.8%)" />
      <SkCard title="Top 10" sub="Largest consumers. Each bar is download, then upload in a tint of the same colour.">
        <SkPlot height={440} />
      </SkCard>
      <SkeletonGap />
      <SkCard
        title="Apps"
        sub="Names and labels come from the phone itself, so there is no guessing. A uid shared by several packages says so, and Android cannot split those figures."
      >
        <SkeletonTable rows={11} />
      </SkCard>
    </>
  );
}
