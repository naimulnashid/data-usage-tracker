import {
  SkPageHead, SkStats, SkStat, SkCard, SkCallout, SkPlot, SkLegend, SkHourly,
  SkHeatmap, SkBar, SkHalves, SkSsidBlock, SkeletonGap,
} from '@/components/Skeleton';
import { WindowsNetworkNote } from '@/components/Notes';
import { splitAppName, windowsDevice } from '@/lib/queries';

/**
 * Overview skeleton, shape-accurate since 2026-09-30: the page's own markup
 * with its own headings (components/Skeleton.tsx), so it wraps where the page
 * wraps at every width rather than being right on average at two.
 *
 * Stand-ins, because a loading boundary has no data: the figures, the legend's
 * app names and the network list's length. Each is sized to what the page
 * usually shows; the network list is the last card, below the
 * first viewport.
 *
 * Measured against the real page 2026-09-30, at 997 and 1680 with the
 * sidebar expanded: every section to the pixel.
 */
export default function Loading() {
  const split = splitAppName();
  return (
    <>
      <SkPageHead
        title={windowsDevice().label}
        sub="Latest data Wednesday, 30 September 2026 · collected 51 min ago"
      />
      <SkStats columns={4}>
        <SkStat label="All" value="681" unit="GB" io={['120 GB', '561 GB']} range="Jun 23 – Sep 30 · 97 days" />
        <SkStat label="Last 30 days" value="184" unit="GB" io={['32.2 GB', '152 GB']} />
        <SkStat label="Last 7 days" value="55.3" unit="GB" io={['10.5 GB', '44.8 GB']} />
        <SkStat label="Today" value="1.32" unit="GB" io={['291 MB', '1.04 GB']} />
      </SkStats>
      <SkCard
        title="Trend"
        sub="Daily total across 100 days, 97 with traffic · 13 days well above trend"
        aside={<SkCallout label="Heaviest day" date="Jul 13" value="27.8 GB" />}
      >
        <SkPlot height={300} />
      </SkCard>
      <SkeletonGap />
      <SkCard
        title="Activity"
        sub="Daily totals. Outlined days were never collected - before collection started, or lost before a run read them - which is not the same as a quiet day."
      >
        <SkHeatmap />
      </SkCard>
      <SkeletonGap />
      <SkCard title="Daily by app" sub="Top 8 apps stacked; everything else grouped as Other">
        <SkPlot height={380} />
        <SkLegend
          logo
          items={['qBittorrent', 'Microsoft Edge', 'Google Drive', 'Microsoft Teams', 'Chrome', 'Discord', 'Node.js', 'VS Code', 'Other']}
        />
      </SkCard>
      <SkeletonGap />
      <SkCard
        title="Hour of day"
        sub="Local time, summed over the selected range"
        aside={<SkCallout label="Busiest hour" date="21:00" value="56.0 GB" />}
      >
        <SkHourly />
      </SkCard>
      {split && (
        <>
          <SkeletonGap />
          <SkCard
            title={`${split} vs everything else`}
            sub={`${split} is 53.2% of named traffic here, so everything else is shown separately at a readable scale`}
          >
            <SkBar />
            <SkHalves
              marginTop="1.6rem"
              halves={[
                { label: split, value: '362', unit: 'GB', sub: '53.2% of named traffic' },
                { label: 'Everything else', value: '319', unit: 'GB', sub: '46.8% of named traffic' },
              ]}
            />
          </SkCard>
        </>
      )}
      <SkeletonGap />
      <SkCard title="Where it went" sub="Wi-Fi against wired, and which network, over the selected range">
        <SkBar />
        <SkHalves
          halves={[
            { label: 'Wi-Fi', value: '681 GB', sub: '100.0% of all traffic' },
            { label: 'Wired', value: '0 B', sub: '0.0% of all traffic' },
          ]}
        />
        <SkSsidBlock head="Networks" note="7 networks" rows={7} footnote={<WindowsNetworkNote />} />
      </SkCard>
    </>
  );
}
