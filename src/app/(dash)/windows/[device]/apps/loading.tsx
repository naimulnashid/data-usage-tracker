import {
  SkPageHead, SkCard, SkPlot, SkeletonGap, SkeletonTable,
} from '@/components/Skeleton';

/**
 * By App skeleton, shape-accurate since 2026-09-30 (components/Skeleton.tsx):
 * the real headings, and the Top 10 plot at its real height -- ten rows of
 * 44px, fixed in `TopAppsChart`.
 *
 * The table is a deliberate departure. The real card lists every app with a
 * detail page -- dozens of rows, thousands of pixels -- and matching that would
 * be a page-long shimmer standing in for rows that are all below the fold.
 * Eleven rows covers the first viewport at both widths, which is the part
 * that can actually jump; rows and header are the measured 53 / 44px.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead title="By App" sub="16 apps · 681 GB attributed · 896 MB unattributed (0.1%)" />
      <SkCard title="Top 10" sub="Largest consumers. Each bar is download, then upload in a tint of the same colour.">
        <SkPlot height={440} />
      </SkCard>
      <SkeletonGap />
      <SkCard
        title="Apps"
        sub="Percentages are of attributed traffic, so they will not quite reach the headline total — the remainder is traffic SRUM could not attribute to a process."
      >
        <SkeletonTable rows={11} columns={6} />
      </SkCard>
    </>
  );
}
