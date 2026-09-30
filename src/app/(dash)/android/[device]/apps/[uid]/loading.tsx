import {
  SkPageHead, SkStats, SkStat, SkCard, SkCallout, SkPlot, SkHourly, SkDataTable,
  SkSsidBlock, SkeletonGap,
} from '@/components/Skeleton';

/**
 * Android app detail skeleton, shape-accurate since 2026-09-30
 * (components/Skeleton.tsx). The head carries the uid badge every phone app
 * has.
 *
 * By network and Package are reproduced because in practice every app has
 * both: a uid that moved bytes moved them on some network, and it has at least
 * one package unless it is one of the unmapped system uids. By network is the
 * one that differs by phone: under its Wi-Fi / mobile table it lists the app's
 * Wi-Fi networks from the USB capture, 13 typically on the phone `/android`
 * opens and 2 on a phone with a short capture. It starts ~1,400px down, below the first
 * viewport at either width.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead back="All apps on this phone" appTitle title="YouTube" badge="uid 10181" sub="Jul 3 – Sep 30 · 90 active days" />
      <SkStats columns={4}>
        <SkStat size="small" label="Total" value="41.2" unit="GB" sub="36.4% of the phone's traffic" />
        <SkStat size="small" label="Downloaded" value="40.4" unit="GB" sub="98.1% of this app" />
        <SkStat size="small" label="Uploaded" value="802" unit="MB" sub="1.9% of this app" />
        <SkStat size="small" label="Per active day" value="458" unit="MB" sub="across 90 days" />
      </SkStats>
      <SkCard
        title="Daily usage"
        sub="Download and upload stacked, on the same shading as the rest of the dashboard"
        aside={<SkCallout label="Heaviest day" date="Aug 30" value="9.84 GB" />}
      >
        <SkPlot height={300} />
      </SkCard>
      <SkeletonGap />
      <SkCard
        title="Hour of day"
        sub="Local time on the phone, in Android's two-hour buckets"
        aside={<SkCallout label="Busiest hour" date="20:00-22:00" value="28.8 GB" />}
      >
        <SkHourly />
      </SkCard>
      <SkeletonGap />
      <SkCard title="By network" sub="Wi-Fi against mobile data for this app alone.">
        <SkDataTable head={['Network', 'Total', 'Share']} rows={2} cells={['Mobile data', '131 GB', 'bar']} />
        <SkSsidBlock head="Wi-Fi networks" rows={13} />
      </SkCard>
      <SkeletonGap />
      <SkCard title="Package" sub="The package behind this uid, as the phone reports it.">
        <SkDataTable className="identity-table" head={['Package', 'Label']} rows={1} cells={['com.google.android.youtube', 'YouTube']} />
      </SkCard>
    </>
  );
}
