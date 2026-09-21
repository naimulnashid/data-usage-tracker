import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { androidTitle } from '@/lib/page-title';
import {
  getAndroidAppDetail, getAndroidAppColorMap, androidAppExists, androidReady,
  earnsAndroidDetailPage, deviceBySlug, getSsidForUid,
} from '@/lib/android-queries';
import { getAppIconMap } from '@/lib/app-icons-server';
import { colorOf } from '@/lib/app-colors';
import { Card, CardTitle } from '@/components/Card';
import { CountUp } from '@/components/CountUp';
import { AppIcon } from '@/components/AppIcon';
import { AppDailyChart, HourlyChart } from '@/components/Charts';
import { AndroidEmpty } from '@/components/AndroidEmpty';
import { parseDays } from '@/lib/scope';
import { formatBytes, formatDayShort, formatPercent, splitBytes } from '@/lib/format';

export const dynamic = 'force-dynamic';

function Stat({
  label, bytes, sub, delay, accent = false,
}: {
  label: string; bytes: number; sub?: string; delay: number; accent?: boolean;
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

/** One detail read per request, shared by the title and the page. See the Windows twin. */
const detailFor = cache((deviceId: string, uid: number, days: number) =>
  getAndroidAppDetail(deviceId, uid, days));

export async function generateMetadata({
  params, searchParams,
}: {
  params: Promise<{ device: string; uid: string }>;
  searchParams: Promise<{ days?: string }>;
}): Promise<Metadata> {
  const { device: slug, uid } = await params;
  const device = androidReady() ? deviceBySlug(slug) : null;
  if (!device || !Number.isInteger(Number(uid))) return androidTitle(slug);
  const app = detailFor(device.deviceId, Number(uid), parseDays((await searchParams).days));
  return androidTitle(slug, app?.name ?? 'App');
}

export default async function AndroidAppPage({
  params, searchParams,
}: {
  params: Promise<{ device: string; uid: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  if (!androidReady()) return <AndroidEmpty />;

  const { device: slug, uid: rawUid } = await params;
  const device = deviceBySlug(slug);
  if (!device) notFound();

  const uid = Number(rawUid);
  if (!Number.isInteger(uid)) notFound();

  const sp = await searchParams;
  const days = parseDays(sp.days);
  const scope = sp.days ? `?days=${sp.days}` : '';

  const app = detailFor(device.deviceId, uid, days);
  if (!app) {
    if (!androidAppExists(device.deviceId, uid)) notFound();
    return (
      <>
        <div className="page-head">
          <h1>Nothing in this range</h1>
          <p>This app moved no data in the selected window.</p>
        </div>
        <Link href={`/android/${slug}/apps`} className="chip">&larr; Back to the app list</Link>
      </>
    );
  }

  // Re-checked here, not just on the table's link: a pasted or bookmarked URL
  // for a trivial uid would otherwise render a page of one bar.
  if (!earnsAndroidDetailPage(app.totals.total, app.days)) notFound();

  const colors = getAndroidAppColorMap(device.deviceId);
  const ssids = getSsidForUid(device.deviceId, uid, days);
  const icons = getAppIconMap(device.slug);
  const color = colorOf(colors, app.name);

  const perDay = app.days > 0 ? app.totals.total / app.days : 0;
  const downShare = app.totals.total > 0 ? (app.totals.rx / app.totals.total) * 100 : 0;
  const busiest = app.hourly.reduce(
    (best, h) => (h.total > best.total ? h : best),
    { hour: 0, total: 0, sent: 0, received: 0 },
  );
  const netTotal = app.byNetwork.reduce((a, n) => a + n.total, 0);

  return (
    <>
      <div className="page-head">
        <Link href={`/android/${slug}/apps${scope}`} className="back-link">&larr; All apps on this phone</Link>
        <h1 className="app-title">
          <AppIcon name={app.name} color={color} icons={icons} size="1.1em" />
          {app.name}
        </h1>
        <p>
          <span className="badge" style={{ marginRight: '0.6rem' }}>uid {app.uid}</span>
          {app.profile > 0 && (
            <span className="badge" style={{ marginRight: '0.6rem' }}>user profile {app.profile}</span>
          )}
          {app.first && app.last && (
            <>
              {formatDayShort(app.first)} &ndash; {formatDayShort(app.last)} ·{' '}
              {app.days} active {app.days === 1 ? 'day' : 'days'}
            </>
          )}
        </p>
      </div>

      <div className="grid grid--4" style={{ marginBottom: '1.15rem' }}>
        <Stat label="Total" bytes={app.totals.total} delay={0} accent
          sub={`${formatPercent(app.share)} of the phone's traffic`} />
        <Stat label="Downloaded" bytes={app.totals.rx} delay={60}
          sub={`${formatPercent(downShare)} of this app`} />
        <Stat label="Uploaded" bytes={app.totals.tx} delay={120}
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
        <CardTitle
          sub={
            `Local time on the phone. Android buckets 2-hourly, so each bar is a two-hour `
            + `block; the busiest is ${String(busiest.hour).padStart(2, '0')}:00-`
            + `${String((busiest.hour + 2) % 24).padStart(2, '0')}:00.`
          }
        >
          Hour of day
        </CardTitle>
        <HourlyChart data={app.hourly} />
      </Card>

      {app.byNetwork.length > 0 && (
        <>
          <div style={{ height: '1.15rem' }} />
          <Card delay={360} hover={false}>
            <CardTitle sub="Wi-Fi against mobile data for this app alone.">
              By network
            </CardTitle>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Network</th><th className="num">Total</th><th style={{ width: '45%' }}>Share</th></tr>
                </thead>
                <tbody>
                  {app.byNetwork.map((n) => (
                    <tr key={n.network}>
                      <td>{n.network === 'wifi' ? 'Wi-Fi' : 'Mobile data'}</td>
                      <td className="num">{formatBytes(n.total)}</td>
                      <td>
                        <div className="bar-track">
                          <div className="bar-fill" style={{
                            width: `${netTotal ? (n.total / netTotal) * 100 : 0}%`,
                            background: 'var(--accent)',
                          }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Which Wi-Fi network, where it is known. Collected over USB,
                because Android does not expose the SSID to apps. */}
            {ssids.length > 0 && (
              <div className="ssid-block">
                <div className="ssid-head"><span>Wi-Fi networks</span></div>
                <table className="ssid-table">
                  <tbody>
                    {ssids.map((n) => (
                      <tr key={n.ssid}>
                        <td className="ssid-name" title={n.ssid}>{n.ssid}</td>
                        <td className="num">{formatBytes(n.total)}</td>
                        <td style={{ width: '45%' }}>
                          <div className="bar-track">
                            <div
                              className="bar-fill"
                              style={{
                                width: `${netTotal ? (n.total / netTotal) * 100 : 0}%`,
                                background: 'var(--accent)',
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/*
        The Android counterpart of the Windows "Merged apps" card, and it exists
        for the same reason: to say out loud why several things are being shown
        as one. Here the merging is Android's own -- a shared uid means the
        kernel cannot tell these packages apart, so neither can this dashboard,
        and pretending otherwise would be inventing an attribution nobody has.
      */}
      {app.packages.length > 0 && (
        <>
          <div style={{ height: '1.15rem' }} />
          <Card delay={420} hover={false}>
            <CardTitle
              sub={
                app.packages.length > 1
                  ? `${app.packages.length} packages share uid ${app.uid}. Android accounts for them together, so these figures cannot be split between them.`
                  : 'The package behind this uid, as the phone reports it.'
              }
            >
              {app.packages.length > 1 ? 'Packages sharing this uid' : 'Package'}
            </CardTitle>
            <div className="table-wrap">
              <table className="identity-table">
                <thead>
                  <tr><th>Package</th><th>Label</th></tr>
                </thead>
                <tbody>
                  {app.packages.map((p) => (
                    <tr key={p.packageName}>
                      <td className="mono identity-cell" title={p.packageName}>{p.packageName}</td>
                      <td>
                        {p.label}
                        {p.isSystem && <span className="badge app-kind" style={{ marginLeft: '0.5rem' }}>system</span>}
                      </td>
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
