import type { Metadata } from 'next';
import { androidTitle } from '@/lib/page-title';
import { notFound } from 'next/navigation';
import {
  getAndroidOverview, getAndroidLastSuccess, getAndroidHeatmap,
  getAndroidTimeline, getAndroidAppColorMap, getSsidBreakdown, deviceBySlug,
  androidReady, type Totals,
} from '@/lib/android-queries';
import { getAppIconMap } from '@/lib/app-icons-server';
import { Card, CardTitle } from '@/components/Card';
import { CountUp } from '@/components/CountUp';
import { DailyTrendChart, HourlyChart, StackedTimelineChart } from '@/components/Charts';
import { ChartLegend } from '@/components/ChartLegend';
import { ActivityHeatmap } from '@/components/ActivityHeatmap';
import { AndroidEmpty } from '@/components/AndroidEmpty';
import { parseDays, scopeQuery } from '@/lib/scope';
import { daySpanLabel } from '@/lib/days';
import {
  formatBytes, formatDayLong, formatDayShort, formatPercent, formatRelative, localDayOf, splitBytes,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

function StatCard({
  label, totals, delay, accent = false, range,
}: {
  label: string; totals: Totals; delay: number; accent?: boolean; range?: string;
}) {
  const { unit } = splitBytes(totals.total);
  return (
    <Card delay={delay}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value${accent ? ' stat-value--accent' : ''}`} style={{ marginTop: '0.5rem' }}>
        <CountUp value={totals.total} mode="bytesValue" />
        <span className="stat-unit">{unit}</span>
      </div>
      <div className="stat-io">
        <span title="Uploaded">&uarr; {formatBytes(totals.tx)}</span>
        <span title="Downloaded">&darr; {formatBytes(totals.rx)}</span>
      </div>
      {range && <div className="stat-range">{range}</div>}
    </Card>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  const { device } = await params;
  return androidTitle(device);
}

export default async function AndroidPage({
  params, searchParams,
}: {
  params: Promise<{ device: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  if (!androidReady()) return <AndroidEmpty />;

  const { device: slug } = await params;
  const device = deviceBySlug(slug);
  if (!device) notFound();

  const sp = await searchParams;
  const days = parseDays(sp.days);
  const id = device.deviceId;
  const data = getAndroidOverview(id, days);
  const lastSync = getAndroidLastSuccess(id);
  const icons = getAppIconMap(device.slug);
  const colors = getAndroidAppColorMap(id);
  const heatmap = getAndroidHeatmap(id);
  const timeline = getAndroidTimeline(id, days);
  const ssid = getSsidBreakdown(id, days);

  const coverage = data.coverage
    ? `${formatDayShort(data.coverage.first)} – ${formatDayShort(data.coverage.last)} · ${data.coverage.days} days`
    : undefined;

  const wifi = data.byNetwork.find((n) => n.network === 'wifi')?.total ?? 0;
  const mobile = data.byNetwork.find((n) => n.network === 'mobile')?.total ?? 0;
  const netTotal = wifi + mobile;

  const busiest = data.hourly.reduce(
    (best, h) => (h.total > best.total ? h : best),
    { hour: 0, total: 0 },
  );

  return (
    <>
      <div className="page-head">
        <h1>{device.label}</h1>
        {/*
          What this line answers is "is what I am looking at current?", so it
          carries the newest DAY held and how long ago the phone last delivered
          anything. The OS version and the last upload's bucket count are
          neither -- they are properties of the device and of one run, and they
          live on the Sync Status page where a run is the subject.

          The two dates are genuinely different questions and both belong here:
          a phone that synced an hour ago can still be a day behind, because
          Android's newest complete bucket is not "now".
        */}
        <p>
          {data.latestDate && <>Latest data {formatDayLong(data.latestDate)}</>}
          {lastSync && (
            <>
              {data.latestDate && ' · '}
              collected {formatRelative(lastSync.hoursAgo)}
            </>
          )}
        </p>
      </div>

      {/*
        "All" ignores the range selector, exactly as it does on the Windows
        side: it answers "how much history do we hold", which a range control
        must not change.
      */}
      <div className="grid grid--4" style={{ marginBottom: '1.15rem' }}>
        <StatCard label="All" totals={data.all} delay={0} accent range={coverage} />
        <StatCard label="Last 30 days" totals={data.month} delay={60} />
        <StatCard label="Last 7 days" totals={data.week} delay={120} />
        <StatCard label="Latest day" totals={data.today} delay={180} />
      </div>

      <Card delay={260} hover={false}>
        <CardTitle
          sub={`Daily total across ${daySpanLabel(data.daily)}`}
          aside={
            data.peak && (
              <div className="callout">
                <div className="callout-head">
                  <span className="callout-label">Heaviest day</span>
                  <span className="callout-date">{formatDayShort(data.peak.date)}</span>
                </div>
                <div className="callout-value">{formatBytes(data.peak.total)}</div>
              </div>
            )
          }
        >
          Trend
        </CardTitle>
        <DailyTrendChart data={data.daily} mean={data.meanDaily} />
      </Card>

      <div style={{ height: '1.15rem' }} />

      {/*
        Deliberately all-time, ignoring the range chips: the heat map's job is
        the shape of months at a glance, and scoping it to 7 days would leave a
        near-empty grid saying nothing the trend chart does not say better.
      */}
      <Card delay={280} hover={false}>
        <CardTitle sub="Daily totals. Outlined days are before this phone started reporting - no data was recorded, which is not the same as a quiet day.">
          Activity
        </CardTitle>
        <ActivityHeatmap
          daily={heatmap}
          earliest={heatmap[0]?.date ?? null}
          expandHref={`/android/${device.slug}/activity${scopeQuery(sp)}`}
        />
      </Card>

      <div style={{ height: '1.15rem' }} />

      <Card delay={300} hover={false}>
        <CardTitle sub={`Top ${timeline.series.filter((x) => x !== 'Other').length} apps stacked; everything else grouped as Other`}>
          Daily by app
        </CardTitle>
        <StackedTimelineChart data={timeline.points} series={timeline.series} colors={colors} />
        <ChartLegend series={timeline.series} colors={colors} icons={icons} />
      </Card>

      <div style={{ height: '1.15rem' }} />

      <Card delay={380} hover={false}>
        <CardTitle
          sub={
            `Local time on the phone. Android buckets 2-hourly, so each bar is a `
            + `two-hour block; the busiest is `
            + `${String(busiest.hour).padStart(2, '0')}:00-${String((busiest.hour + 2) % 24).padStart(2, '0')}:00.`
          }
        >
          Hour of day
        </CardTitle>
        <HourlyChart data={data.hourly} />
      </Card>

      <div style={{ height: '1.15rem' }} />

      <Card delay={320} hover={false}>
        <CardTitle sub="Wi-Fi against mobile data, across the whole recorded history">
          Where it went
        </CardTitle>
        <div className="net-split">
          <div className="net-bar">
            <div
              className="net-bar-fill net-bar-fill--wifi"
              style={{ width: `${netTotal ? (wifi / netTotal) * 100 : 0}%` }}
              title={`Wi-Fi — ${formatBytes(wifi)}`}
            />
            <div
              className="net-bar-fill net-bar-fill--mobile"
              style={{ width: `${netTotal ? (mobile / netTotal) * 100 : 0}%` }}
              title={`Mobile — ${formatBytes(mobile)}`}
            />
          </div>
          <div className="grid grid--2" style={{ marginTop: '1.4rem' }}>
            <div>
              <div className="legend-item"><span className="legend-swatch net-swatch--wifi" />Wi-Fi</div>
              <div className="stat-value net-value--wifi">{formatBytes(wifi)}</div>
              <div className="stat-sub">{formatPercent(netTotal ? (wifi / netTotal) * 100 : 0)} of all traffic</div>
            </div>
            <div>
              <div className="legend-item"><span className="legend-swatch net-swatch--mobile" />Mobile data</div>
              <div className="stat-value net-value--mobile">{formatBytes(mobile)}</div>
              <div className="stat-sub">{formatPercent(netTotal ? (mobile / netTotal) * 100 : 0)} of all traffic</div>
            </div>
          </div>

          {/*
            Which Wi-Fi network. Android knows this per app but does not expose
            it to apps at all, so it is collected over USB by
            scripts/android-ssid-collect.ts and lives in its own table.
          */}
          {ssid.networks.length > 0 && (
            <div className="ssid-block">
              <div className="ssid-head">
                <span>Wi-Fi networks</span>
                {ssid.coverage && (
                  <span className="ssid-note">
                    {formatDayShort(ssid.coverage.first)} &ndash; {formatDayShort(ssid.coverage.last)}
                    {ssid.lastCollected && (
                      <> · collected over USB {formatDayShort(localDayOf(ssid.lastCollected))}</>
                    )}
                  </span>
                )}
              </div>
              <table className="ssid-table">
                <tbody>
                  {ssid.networks.map((n) => (
                    <tr key={n.ssid}>
                      <td className="ssid-name" title={n.ssid}>{n.ssid}</td>
                      <td className="num">{formatBytes(n.total)}</td>
                      <td style={{ width: '45%' }}>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${ssid.wifiTotal ? (n.total / ssid.wifiTotal) * 100 : 0}%`,
                              background: 'var(--accent)',
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {ssid.unattributed > 0 && (
                    <tr>
                      <td
                        className="ssid-name ssid-name--dim"
                        title="Traffic that crossed a VPN carries no network name"
                      >
                        Over a VPN
                      </td>
                      <td className="num" style={{ color: 'var(--text-faint)' }}>
                        {formatBytes(ssid.unattributed)}
                      </td>
                      <td>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${ssid.wifiTotal ? (ssid.unattributed / ssid.wifiTotal) * 100 : 0}%`,
                              background: 'var(--text-faint)',
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="ssid-note ssid-note--block">
                {/*
                  The window matters, and stating it is what makes the VPN
                  figure trustworthy. Android exposes the SSID only through
                  dumpsys, whose history is shorter than the app's, so these
                  rows are compared against Wi-Fi over the SAME days rather
                  than against the whole range.
                */}
                Android does not give apps the network name, so this comes from a USB
                capture and covers a shorter span than the rest of the page
                {ssid.rangeExceedsCoverage && <> &mdash; the selected range reaches back further</>}.
                {ssid.unattributed > 0 && (
                  <> Traffic that crossed a VPN carries no network name and is shown apart
                    rather than spread across the networks above.</>
                )}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/*
        Last, not first. It is a caveat about a figure the reader has already
        seen, and leading with it pushed the actual numbers below the fold. It
        stays a full card rather than a footnote because it is the one thing
        that would make someone add two totals that must not be added.
      */}
      {data.tethering > 0 && (
        <>
          <div style={{ height: '1.15rem' }} />
          <Card delay={500} hover={false}>
            <CardTitle sub="Excluded from every figure on this page, including the app list.">
              Tethering is counted twice
            </CardTitle>
            <p className="prose-note">
              <strong>{formatBytes(data.tethering)}</strong> of traffic in this window was
              relayed by the phone for other devices. If your laptop tethers off this
              phone, those same bytes are also recorded on the laptop, under Windows app
              names. Adding the two devices&rsquo; totals together would count them twice, so
              this figure is kept out of the totals rather than folded in.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
