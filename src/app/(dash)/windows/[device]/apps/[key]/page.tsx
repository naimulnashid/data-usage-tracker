import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { windowsTitle } from '@/lib/page-title';
import {
  getAppDetail, getAppColorMap, getRowCount, appExists, databaseExists,
  earnsDetailPage, windowsDeviceBySlug, type Scope,
} from '@/lib/queries';
import { colorOf } from '@/lib/app-colors';
import { getAppIconMap } from '@/lib/app-icons-server';
import { AppIcon } from '@/components/AppIcon';
import { Card, CardTitle } from '@/components/Card';
import { CountUp } from '@/components/CountUp';
import { AppDailyChart, HourlyChart } from '@/components/Charts';
import { EmptyState } from '@/components/EmptyState';
import { parseDays } from '@/lib/scope';
import { formatBytes, formatCount, formatDayShort, formatPercent, splitBytes } from '@/lib/format';

export const dynamic = 'force-dynamic';

function Stat({
  label, bytes, sub, delay, accent = false,
}: {
  label: string;
  bytes: number;
  sub?: string;
  delay: number;
  /**
   * The headline figure, in the accent. Exactly one card per grid should set
   * this -- it is what makes the row read as "this number, with context"
   * rather than four equal numbers. Matches Overview's "All" card.
   */
  accent?: boolean;
}) {
  const { unit } = splitBytes(bytes);
  return (
    <Card delay={delay}>
      <div className="stat-label">{label}</div>
      <div
        className={`stat-value${accent ? ' stat-value--accent' : ''}`}
        style={{ marginTop: '0.5rem', fontSize: '1.9rem' }}
      >
        <CountUp value={bytes} mode="bytesValue" />
        <span className="stat-unit">{unit}</span>
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </Card>
  );
}

/**
 * The detail query, once per request. The title needs the app's display name
 * and the page needs everything; React's cache() lets generateMetadata and the
 * page share one read. Primitive arguments, because cache() compares them by
 * identity and a fresh Scope object would never hit.
 */
const detailFor = cache((key: string, days: number, profileId: string | null) =>
  getAppDetail(key, { days, profileId }));

export async function generateMetadata({
  params, searchParams,
}: {
  params: Promise<{ device: string; key: string }>;
  searchParams: Promise<{ days?: string; profile?: string }>;
}): Promise<Metadata> {
  const { device, key } = await params;
  if (!databaseExists()) return windowsTitle(device);
  const sp = await searchParams;
  const app = detailFor(decodeURIComponent(key), parseDays(sp.days), sp.profile ?? null);
  return windowsTitle(device, app?.name ?? 'App');
}

export default async function AppDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ device: string; key: string }>;
  searchParams: Promise<{ days?: string; profile?: string }>;
}) {
  if (!databaseExists()) return <EmptyState />;

  const { device: slug, key } = await params;
  const device = windowsDeviceBySlug(slug);
  if (!device) notFound();
  const base = `/windows/${device.slug}`;
  const sp = await searchParams;
  const scope: Scope = { days: parseDays(sp.days), profileId: sp.profile ?? null };

  const app = detailFor(decodeURIComponent(key), scope.days, scope.profileId);
  const colors = getAppColorMap();
  const icons = getAppIconMap(device.slug);

  // An app with no rows in this scope is not a 404 -- the app exists, the
  // selection is just empty. Say which, rather than showing "not found" for a
  // date range the user can simply widen. A key that matches nothing at all IS
  // a 404, and saying "nothing in this range" for it would send the reader
  // hunting for a range that does not exist.
  if (!app) {
    if (getRowCount() === 0) return <EmptyState />;
    if (!appExists(decodeURIComponent(key))) notFound();
    return (
      <>
        <div className="page-head">
          <h1>Nothing in this range</h1>
          <p>This app moved no data in the selected window or network.</p>
        </div>
        <Link href={`${base}/apps`} className="chip">&larr; All apps</Link>
      </>
    );
  }

  // Eligibility is checked here too, not just in the table's link. A pasted or
  // bookmarked URL for a trivial app would otherwise render a page of one bar.
  if (!earnsDetailPage(app.totals.total, app.days)) notFound();

  const busiest = app.hourly.reduce(
    (best, h) => (h.total > best.total ? h : best),
    { hour: 0, total: 0, sent: 0, received: 0 },
  );
  const perDay = app.days > 0 ? app.totals.total / app.days : 0;
  const downShare = app.totals.total > 0 ? (app.totals.received / app.totals.total) * 100 : 0;

  return (
    <>
      <div className="page-head">
        <Link href={`${base}/apps`} className="back-link">&larr; All apps</Link>
        <h1 className="app-title">
          <AppIcon name={app.name} color={colorOf(colors, app.name)} icons={icons} size="1.1em" />
          {app.name}
        </h1>
        <p>
          {app.kind !== 'path' && (
            <span className="badge" style={{ marginRight: '0.6rem' }}>
              {app.kind === 'appx' ? 'store app' : app.kind}
            </span>
          )}
          {app.first && app.last && (
            <>
              {formatDayShort(app.first)} &ndash; {formatDayShort(app.last)} ·{' '}
              {app.days} active {app.days === 1 ? 'day' : 'days'} ·{' '}
              {formatCount(app.rows)} records
            </>
          )}
        </p>
      </div>

      <div className="grid grid--4" style={{ marginBottom: '1.15rem' }}>
        <Stat label="Total" bytes={app.totals.total} delay={0} accent
          sub={`${formatPercent(app.share)} of all attributed traffic`} />
        <Stat label="Downloaded" bytes={app.totals.received} delay={60}
          sub={`${formatPercent(downShare)} of this app`} />
        <Stat label="Uploaded" bytes={app.totals.sent} delay={120}
          sub={`${formatPercent(100 - downShare)} of this app`} />
        <Stat label="Per active day" bytes={perDay} delay={180}
          sub={`across ${app.days} ${app.days === 1 ? 'day' : 'days'}`} />
      </div>

      <Card delay={240} hover={false}>
        <CardTitle
          sub="Download and upload stacked, on the same shading as the rest of the dashboard"
          aside={
            app.peak && (
              <div className="callout">
                <div className="callout-head">
                  <span className="callout-label">Heaviest day</span>
                  <span className="callout-date">{formatDayShort(app.peak.date)}</span>
                </div>
                <div className="callout-value">{formatBytes(app.peak.total)}</div>
              </div>
            )
          }
        >
          Daily usage
        </CardTitle>
        <AppDailyChart data={app.daily} />
      </Card>

      <div style={{ height: '1.15rem' }} />

      <Card delay={300} hover={false}>
        <CardTitle sub={`Local time. Busiest hour is ${String(busiest.hour).padStart(2, '0')}:00.`}>
          Hour of day
        </CardTitle>
        <HourlyChart data={app.hourly} />
      </Card>

      {app.networks.length > 0 && (
        <>
          <div style={{ height: '1.15rem' }} />
          <Card delay={360} hover={false}>
            <CardTitle sub="Which network this app used. Unnamed profiles fill in as the collector sees them again.">
              By network
            </CardTitle>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Network</th><th className="num">Total</th><th style={{ width: '45%' }}>Share</th></tr>
                </thead>
                <tbody>
                  {app.networks.map((n) => (
                    <tr key={n.id}>
                      <td>{n.label}</td>
                      <td className="num">{formatBytes(n.bytes)}</td>
                      <td>
                        <div className="bar-track">
                          <div className="bar-fill" style={{
                            width: `${(n.bytes / app.totals.total) * 100}%`,
                            background: 'var(--accent)',
                          }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {app.members.length > 1 && (
        <>
          <div style={{ height: '1.15rem' }} />
          <Card delay={400} hover={false}>
            {/*
              Shown only when something was actually merged. This is the answer
              to "why is Claude one row when I run two different Claude
              programs" -- the merge is stated, with the split that produced it,
              rather than left for the reader to infer from a total that looks
              too big.
            */}
            <CardTitle
              sub={`${app.members.length} separate programs are counted together as ${app.name}. Their totals are added; nothing is double-counted.`}
            >
              Merged apps
            </CardTitle>
            <div className="table-wrap">
              <table className="member-table">
                <thead>
                  <tr>
                    <th>Program</th>
                    <th className="num">Active days</th>
                    <th className="num">Total</th>
                    <th style={{ width: '32%' }}>Share of {app.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {app.members.map((m) => (
                    <tr key={m.key}>
                      <td>
                        <span className="app-cell">
                          <AppIcon name={m.name} color={colorOf(colors, app.name)} icons={icons} />
                          <span className="app-name" title={m.name}>{m.name}</span>
                        </span>
                      </td>
                      <td className="num" style={{ color: 'var(--text-faint)' }}>{m.days}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{formatBytes(m.bytes)}</td>
                      <td>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${app.totals.total ? (m.bytes / app.totals.total) * 100 : 0}%`,
                              background: colorOf(colors, app.name),
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {app.identities.length > 1 && (
        <>
          <div style={{ height: '1.15rem' }} />
          <Card delay={420} hover={false}>
            {/*
              Only shown when there is more than one, because that is the
              interesting case: it is the evidence for why several raw strings
              are being presented as one app.
            */}
            <CardTitle sub={`${app.identities.length} raw SRUM identities are grouped under this app - usually different installed versions.`}>
              Grouped from
            </CardTitle>
            <div className="table-wrap">
              <table className="identity-table">
                <thead>
                  <tr><th>SRUM identity</th><th className="num">Total</th></tr>
                </thead>
                <tbody>
                  {app.identities.map((id) => (
                    <tr key={id.identity}>
                      <td className="mono identity-cell" title={id.identity}>{id.identity}</td>
                      <td className="num">{formatBytes(id.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
