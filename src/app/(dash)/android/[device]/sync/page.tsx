import type { Metadata } from 'next';
import { Pager } from '@/components/Pager';
import { clampPage } from '@/lib/pager';
import { androidTitle } from '@/lib/page-title';
import { notFound } from 'next/navigation';
import {
  getAndroidSyncStatus, deviceBySlug, androidReady,
  SYNC_WARN_HOURS, SYNC_CRITICAL_HOURS, RETENTION_DAYS,
} from '@/lib/android-queries';
import { Card, CardTitle } from '@/components/Card';
import { AndroidSyncNotes } from '@/components/Notes';
import { AndroidEmpty } from '@/components/AndroidEmpty';
import { formatCount, formatDateTime, formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Whether the phone is still reporting.
 *
 * The Windows Sync Status page exists because a stopped collector is invisible
 * until a reset has already destroyed the history. **This page is not that**,
 * and it deliberately does not borrow that page's alarm: Android keeps ~90 days
 * of its own, so a phone that has not reported for a week has lost nothing.
 *
 * What matters here is runway -- how long the phone can stay away before
 * Android starts deleting buckets that were never collected. That is the figure
 * this page leads with.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  const { device } = await params;
  return androidTitle(device, 'Sync Status');
}

/** Upload history page size, as on the laptop's run history. */
const PAGE_SIZE = 25;

export default async function AndroidSyncPage({
  params, searchParams,
}: {
  params: Promise<{ device: string }>;
  searchParams: Promise<{ uploads?: string }>;
}) {
  if (!androidReady()) return <AndroidEmpty />;

  const { device: slug } = await params;
  const device = deviceBySlug(slug);
  if (!device) notFound();

  // Paged like the laptop's run history: the log grows with every upload,
  // and a page is a URL. A number past the end lands on the last page.
  const sp = await searchParams;
  const first = getAndroidSyncStatus(device.deviceId, PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(first.totalRuns / PAGE_SIZE));
  const page = clampPage(sp.uploads, pageCount);
  const data = page === 1 ? first : getAndroidSyncStatus(device.deviceId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const firstOnPage = (page - 1) * PAGE_SIZE + 1;
  const lastOnPage = Math.min(page * PAGE_SIZE, data.totalRuns);

  const hours = data.hoursSinceSuccess;
  const late = hours != null && hours > SYNC_WARN_HOURS;
  const critical = hours != null && hours > SYNC_CRITICAL_HOURS;
  const failing = data.consecutiveFailures >= 2;

  const runway = data.runwayDays;
  const runwayLow = runway != null && runway < 14;

  return (
    <>
      <div className="page-head">
        <h1>Sync Status</h1>
        {/*
          The OS version lives here rather than on the overview. It is a
          property of the device, not of its traffic, and the one time it
          matters is when an upload starts failing -- `NetworkStatsManager`
          behaviour and the usage-access appop are both version-dependent, so
          the number belongs next to the run history that would show the
          symptom.
        */}
        <p>
          Android {device.release} (API {device.sdk}) &middot; {device.label} pushes
          on its own schedule &mdash; every 6 hours, on unmetered networks only.
          Nothing here triggers it.
        </p>
      </div>

      {(critical || failing) && (
        <div className="alert animate-in" style={{ marginBottom: '1.15rem' }}>
          <div>
            <h2>{failing ? 'Uploads are being rejected' : 'History is about to be lost'}</h2>
            <p style={{ margin: '0.4rem 0 0', color: 'var(--text)' }}>
              {failing
                ? `The last ${data.consecutiveFailures} uploads failed. See the reason in the run history below.`
                : `Nothing has been collected for ${hours != null ? Math.round(hours / 24) : '?'} days, and Android deletes its own per-app history after about ${RETENTION_DAYS}.`}
            </p>
            <p style={{ margin: '0.6rem 0 0', color: 'var(--text-dim)', fontSize: 'var(--fs-small)' }}>
              Open <strong>Data Usage Reporter</strong> on the phone, check that usage access
              is still granted, and tap <strong>Sync now</strong>.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid--3" style={{ marginBottom: '1.15rem' }}>
        <Card delay={0}>
          <div className="stat-label">Last upload</div>
          <div
            className="stat-value"
            style={{
              marginTop: '0.5rem', fontSize: '1.9rem',
              color: critical ? 'var(--danger)' : late ? 'var(--text)' : 'var(--accent-bright)',
            }}
          >
            {hours != null ? formatRelative(hours) : 'never'}
          </div>
          <div className="stat-sub">
            {data.lastSuccessAt ? formatDateTime(data.lastSuccessAt) : 'no successful upload recorded'}
          </div>
        </Card>

        {/*
          The figure that actually matters, and the reason this page does not
          simply copy the Windows one. Being late is only a problem in relation
          to what Android is about to delete.
        */}
        <Card delay={70}>
          <div className="stat-label">Collection runway</div>
          <div
            className="stat-value"
            style={{
              marginTop: '0.5rem', fontSize: '1.9rem',
              color: runwayLow ? 'var(--danger)' : 'var(--text)',
            }}
          >
            {runway != null ? `${Math.max(0, Math.round(runway))} days` : '—'}
          </div>
          <div className="stat-sub">
            before Android deletes anything not yet collected
          </div>
        </Card>

        <Card delay={140}>
          <div className="stat-label">Stored</div>
          <div className="stat-value" style={{ marginTop: '0.5rem', fontSize: '1.9rem' }}>
            {formatCount(data.records)}
          </div>
          <div className="stat-sub">
            {data.days} days · {data.apps} uids
          </div>
        </Card>
      </div>

      <Card delay={210} hover={false}>
        <CardTitle
          sub={
            'An upload that stores 0 new rows is normal and healthy: the phone re-sends the '
            + 'most recent bucket every time, because it was still filling when it was last read. '
            + '"Updated" is that bucket being replaced with its finished value.'
          }
          aside={
            data.totalRuns > 0 && (
              <span className="callout-sub" style={{ whiteSpace: 'nowrap' }}>
                {firstOnPage}&ndash;{lastOnPage} of {data.totalRuns}
              </span>
            )
          }
        >
          Upload history
        </CardTitle>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Status</th>
                <th className="num">Buckets sent</th>
                <th className="num">New</th>
                <th className="num">Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r, i) => (
                <tr key={`${r.receivedAt}-${i}`}>
                  {/* nowrap, as on the Windows run history: on a phone the
                      date broke into lines and each row reached 109px, while
                      the table scrolled sideways regardless. */}
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.receivedAt)}</td>
                  <td>
                    <span className={`badge ${r.status === 'success' ? 'badge--ok' : 'badge--bad'}`}>
                      {r.status}
                    </span>
                    {r.error && (
                      <span
                        className="mono"
                        style={{ marginLeft: '0.6rem', color: 'var(--text-faint)', fontSize: '0.8125rem' }}
                        title={r.error}
                      >
                        {r.error.slice(0, 60)}
                      </span>
                    )}
                  </td>
                  <td className="num">{formatCount(r.bucketsSent)}</td>
                  <td className="num" style={{ fontWeight: r.rowsWritten > 0 ? 600 : 400 }}>
                    {formatCount(r.rowsWritten)}
                  </td>
                  <td className="num" style={{ color: 'var(--text-dim)' }}>
                    {formatCount(r.rowsUpdated)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} count={pageCount} path={`/android/${device.slug}/sync`} param="uploads" />
      </Card>

      <div style={{ height: '1.15rem' }} />

      <Card delay={280} hover={false}>
        <CardTitle sub="Why a late phone is not the same emergency it would be on the Windows side.">
          How this differs from the collector
        </CardTitle>
        <AndroidSyncNotes />
      </Card>
    </>
  );
}
