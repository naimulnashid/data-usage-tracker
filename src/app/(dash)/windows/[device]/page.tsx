import type { Metadata } from 'next';
import { windowsTitle } from '@/lib/page-title';
import { notFound } from 'next/navigation';
import {
  getOverview, getSync, getHeatmap, getTimeline, getAppColorMap, getRowCount,
  windowsDeviceBySlug, databaseExists, type Scope, type Totals,
} from '@/lib/queries';
import { getAppIconMap } from '@/lib/app-icons-server';
import { Card, CardTitle } from '@/components/Card';
import { CountUp } from '@/components/CountUp';
import { DailyTrendChart, StackedTimelineChart, HourlyChart } from '@/components/Charts';
import { ChartLegend } from '@/components/ChartLegend';
import { SplitBar } from '@/components/SplitBar';
import { ActivityHeatmap } from '@/components/ActivityHeatmap';
import { EmptyState, NoDataInScope } from '@/components/EmptyState';
import { parseDays } from '@/lib/scope';
import { daySpanLabel } from '@/lib/days';
import {
  formatBytes, formatDayLong, formatDayShort, formatPercent, formatRelative, splitBytes,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * One score card.
 *
 * All four carry sent/received, not just the newest day: the split between
 * upload and download is the whole shape of a machine that seeds or uploads, and
 * showing it on one card only invited comparing figures that were not alike.
 */
function StatCard({
  label, totals, delay, accent = false, range,
}: {
  label: string;
  totals: Totals;
  delay: number;
  /** The headline figure. Exactly one card should set this. */
  accent?: boolean;
  /** Extra line under the arrows, for stating what "All" actually covers. */
  range?: string;
}) {
  const { unit } = splitBytes(totals.total);
  return (
    <Card delay={delay}>
      <div className="stat-label">{label}</div>
      <div
        className={`stat-value${accent ? ' stat-value--accent' : ''}`}
        style={{ marginTop: '0.5rem' }}
      >
        <CountUp value={totals.total} mode="bytesValue" />
        <span className="stat-unit">{unit}</span>
      </div>
      <div className="stat-io">
        <span title="Uploaded">&uarr; {formatBytes(totals.sent)}</span>
        <span title="Downloaded">&darr; {formatBytes(totals.received)}</span>
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
  return windowsTitle(device);
}

export default async function OverviewPage({
  params, searchParams,
}: {
  params: Promise<{ device: string }>;
  searchParams: Promise<{ days?: string; profile?: string }>;
}) {
  if (!databaseExists()) return <EmptyState />;

  // A slug that is not this machine is a 404, not this machine's numbers under
  // another name. After a `deviceLabel` rename, old bookmarks land here.
  const { device: slug } = await params;
  const device = windowsDeviceBySlug(slug);
  if (!device) notFound();
  const base = `/windows/${device.slug}`;

  const sp = await searchParams;
  const scope: Scope = {
    days: parseDays(sp.days),
    profileId: sp.profile ?? null,
  };

  const data = getOverview(scope);
  const heatmap = getHeatmap(scope.profileId);
  const timeline = getTimeline(scope);
  const sync = getSync(1);
  const colors = getAppColorMap();
  const icons = getAppIconMap(device.slug);

  if (!data.latestDate) {
    // Distinguish an empty database from an empty selection.
    return getRowCount() === 0
      ? <EmptyState />
      : <NoDataInScope scoped={scope.profileId !== null} home={base} />;
  }

  const todayIso = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
  const isCurrent = data.latestDate === todayIso;
  const latestLabel = isCurrent ? 'Today' : `Latest day · ${formatDayShort(data.latestDate)}`;

  // The split card appears only when an app is configured AND moved something
  // in this range; a card reading "0 B vs everything" says nothing.
  const { split } = data;
  const splitTotal = split.focus + split.other;
  const focusPct = splitTotal ? (split.focus / splitTotal) * 100 : 0;
  const showSplit = split.app !== null && split.focus > 0;

  // Days above 2.5x the mean. Matches the chart's threshold, and stays rare
  // enough that red still means something.
  const spikes = data.daily.filter((d) => data.meanDaily > 0 && (d.total ?? 0) > data.meanDaily * 2.5);

  const stale = sync.hoursSinceSuccess != null && sync.hoursSinceSuccess > 48;

  const coverage = data.coverage
    ? `${formatDayShort(data.coverage.first)} – ${formatDayShort(data.coverage.last)} · ${data.coverage.days} days`
    : undefined;

  const busiest = timeline.hourly.reduce(
    (best, h) => (h.total > best.total ? h : best),
    { hour: 0, total: 0 },
  );

  return (
    <>
      <div className="page-head">
        <h1>{device.label}</h1>
        <p>
          Latest data {formatDayLong(data.latestDate)}
          {sync.hoursSinceSuccess != null && ` · collected ${formatRelative(sync.hoursSinceSuccess)}`}
          {stale && <span className="badge badge--bad" style={{ marginLeft: '0.7rem' }}>collector may be stalled</span>}
        </p>
      </div>

      {/*
        Widest window first, narrowing left to right. "All" is the figure this
        project exists to preserve, so it leads and carries the accent; the
        other three are context around it and stay near-white.

        "All" deliberately ignores the range selector -- it answers "how much
        history do we hold", which a range control must not change. The date
        line under it says exactly what that covers.
      */}
      <div className="grid grid--4" style={{ marginBottom: '1.15rem' }}>
        <StatCard label="All" totals={data.all} delay={0} accent range={coverage} />
        <StatCard label="Last 30 days" totals={data.month} delay={60} />
        <StatCard label="Last 7 days" totals={data.week} delay={120} />
        <StatCard label={latestLabel} totals={data.today} delay={180} />
      </div>

      <Card delay={240} hover={false}>
        <CardTitle
          sub={`Daily total across ${daySpanLabel(data.daily)}${spikes.length ? ` · ${spikes.length} day${spikes.length > 1 ? 's' : ''} well above trend` : ''}`}
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

      <Card delay={300} hover={false}>
        <CardTitle sub="Daily totals. Outlined days were never collected - before collection started, or lost before a run read them - which is not the same as a quiet day.">
          Activity
        </CardTitle>
        <ActivityHeatmap daily={heatmap} />
      </Card>

      <div style={{ height: '1.15rem' }} />

      <Card delay={360} hover={false}>
        <CardTitle sub={`Top ${timeline.series.filter((s) => s !== 'Other').length} apps stacked; everything else grouped as Other`}>
          Daily by app
        </CardTitle>
        <StackedTimelineChart data={timeline.points} series={timeline.series} colors={colors} />
        <ChartLegend series={timeline.series} colors={colors} icons={icons} />
      </Card>

      <div style={{ height: '1.15rem' }} />

      <Card delay={420} hover={false}>
        <CardTitle sub={`Local time. Busiest hour is ${String(busiest.hour).padStart(2, '0')}:00.`}>
          Hour of day
        </CardTitle>
        <HourlyChart data={timeline.hourly} />
      </Card>

      {showSplit && split.app && (
        <>
          <div style={{ height: '1.15rem' }} />

          <Card delay={480} hover={false}>
            <CardTitle sub={`${split.app} is ${formatPercent(focusPct)} of named traffic here, so everything else is shown separately at a readable scale`}>
              {split.app} vs everything else
            </CardTitle>
            <SplitBar
              app={split.app}
              focus={split.focus}
              other={split.other}
              focusPct={focusPct}
              colors={colors}
              icons={icons}
            />
          </Card>
        </>
      )}
    </>
  );
}
