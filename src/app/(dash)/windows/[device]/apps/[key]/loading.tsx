import {
  SkPageHead, SkStats, SkStat, SkCard, SkCallout, SkPlot, SkHourly, SkDataTable, SkeletonGap,
} from '@/components/Skeleton';

/**
 * App detail skeleton, shape-accurate since 2026-09-30 (components/Skeleton.tsx).
 *
 * The head carries no kind badge: most apps are exes, and a store app or a
 * service is 6px taller for it. By network is reproduced because every app
 * has it -- an app that moved bytes moved them on some network -- with the
 * five rows the median app shows. The cards below it, Merged
 * apps and Grouped from, are NOT: both are conditional, Grouped from alone
 * ranges from 277px to 9,719px, and a skeleton that promises cards an app may
 * not have is a worse kind of wrong than one that stops short.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead back="All apps" appTitle title="Microsoft Edge" sub="Jun 23 – Sep 30 · 96 active days · 2,845 records" />
      <SkStats columns={4}>
        <SkStat size="small" label="Total" value="138" unit="GB" sub="20.3% of all attributed traffic" />
        <SkStat size="small" label="Downloaded" value="129" unit="GB" sub="93.9% of this app" />
        <SkStat size="small" label="Uploaded" value="8.41" unit="GB" sub="6.1% of this app" />
        <SkStat size="small" label="Per active day" value="1.44" unit="GB" sub="across 96 days" />
      </SkStats>
      <SkCard
        title="Daily usage"
        sub="Download and upload stacked, on the same shading as the rest of the dashboard"
        aside={<SkCallout label="Heaviest day" date="Sep 17" value="2.58 GB" />}
      >
        <SkPlot height={300} />
      </SkCard>
      <SkeletonGap />
      <SkCard
        title="Hour of day"
        sub="Local time, summed over the selected range"
        aside={<SkCallout label="Busiest hour" date="11:00" value="15.7 GB" />}
      >
        <SkHourly />
      </SkCard>
      <SkeletonGap />
      <SkCard title="By network" sub="Which network this app used. Unnamed profiles fill in as the collector sees them again.">
        <SkDataTable head={['Network', 'Total', 'Share']} rows={5} cells={['HomeNet-5G', '131 GB', 'bar']} />
      </SkCard>
    </>
  );
}
