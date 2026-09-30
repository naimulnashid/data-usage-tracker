import {
  SkPageHead, SkStats, SkStat, SkCard, SkCallout, SkPlot, SkLegend, SkHourly,
  SkHeatmap, SkBar, SkHalves, SkSsidBlock, SkMask, SkeletonGap,
} from '@/components/Skeleton';

/**
 * Android overview skeleton, shape-accurate since 2026-09-30
 * (components/Skeleton.tsx): the page's own markup and headings, so it wraps
 * where the page wraps at every width.
 *
 * **Sized to the phone `/android` opens** -- the one with the most data --
 * because a loading boundary is not given the device. Two sections differ
 * between phones, both far below the first viewport:
 *
 * - "Where it went" carries a row per Wi-Fi network in the USB capture: 17 on
 *   that phone, 2 on a phone with a short capture.
 * - Tethering appears only on a phone that tethered in the range.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead title="Phone" sub="Latest data Wednesday, 30 September 2026 · collected 41 min ago" />
      <SkStats columns={4}>
        <SkStat label="All" value="114" unit="GB" io={['6.86 GB', '107 GB']} range="Jul 3 – Sep 30 · 90 days" />
        <SkStat label="Last 30 days" value="32.3" unit="GB" io={['2.10 GB', '30.2 GB']} />
        <SkStat label="Last 7 days" value="6.73" unit="GB" io={['520 MB', '6.22 GB']} />
        <SkStat label="Latest day" value="1007" unit="MB" io={['80.1 MB', '927 MB']} />
      </SkStats>
      <SkCard
        title="Trend"
        sub="Daily total across 90 days"
        aside={<SkCallout label="Heaviest day" date="Aug 30" value="3.24 GB" />}
      >
        <SkPlot height={300} />
      </SkCard>
      <SkeletonGap />
      <SkCard
        title="Activity"
        sub="Daily totals. Outlined days are before this phone started reporting - no data was recorded, which is not the same as a quiet day."
      >
        <SkHeatmap />
      </SkCard>
      <SkeletonGap />
      <SkCard title="Daily by app" sub="Top 8 apps stacked; everything else grouped as Other">
        <SkPlot height={380} />
        <SkLegend
          logo
          items={['YouTube', 'Instagram', 'Netflix', 'Google Play Store', 'Chrome', 'WhatsApp', 'Spotify', 'Google Play services', 'Other']}
        />
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
      <SkCard title="Where it went" sub="Wi-Fi against mobile data, across the whole recorded history">
        <SkBar />
        <SkHalves
          halves={[
            { label: 'Wi-Fi', value: '83.1 GB', sub: '72.7% of all traffic' },
            { label: 'Mobile data', value: '31.2 GB', sub: '27.3% of all traffic' },
          ]}
        />
        <SkSsidBlock
          head="Wi-Fi networks"
          note="Jul 3 – Sep 27 · collected over USB Sep 27"
          rows={17}
          footnote={
            <p className="ssid-note ssid-note--block">
              Android does not give apps the network name, so this comes from a USB capture and
              covers a shorter span than the rest of the page &mdash; the selected range reaches
              back further. Traffic that crossed a VPN carries no network name and is shown apart
              rather than spread across the networks above.
            </p>
          }
        />
      </SkCard>
      <SkeletonGap />
      <SkCard title="Tethering is counted twice" sub="Excluded from every figure on this page, including the app list.">
        <SkMask>
          <p className="prose-note">
            <strong>931 MB</strong> of traffic in this window was relayed by the phone for other
            devices. If your laptop tethers off this phone, those same bytes are also recorded on
            the laptop, under Windows app names. Adding the two devices&rsquo; totals together would
            count them twice, so this figure is kept out of the totals rather than folded in.
          </p>
        </SkMask>
      </SkCard>
    </>
  );
}
