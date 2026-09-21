import type { Metadata } from 'next';
import { windowsTitle } from '@/lib/page-title';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSync, windowsDeviceBySlug, databaseExists } from '@/lib/queries';
import { Card, CardTitle } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import {
  formatCount, formatDateTime, formatDuration, formatRelative,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The page that protects the whole premise.
 *
 * Everything else here is retrospective. This one is the only thing that tells
 * you the collector has stopped -- and a stopped collector is invisible until a
 * Windows reset has already destroyed the history it should have been saving.
 * That is why staleness and consecutive failures are stated as loud, plain
 * banners rather than a status dot someone has to go looking for.
 */
/** Run history page size. */
const PAGE_SIZE = 25;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  const { device } = await params;
  return windowsTitle(device, 'Sync Status');
}

export default async function SyncPage({
  params, searchParams,
}: {
  params: Promise<{ device: string }>;
  searchParams: Promise<{ runs?: string }>;
}) {
  if (!databaseExists()) return <EmptyState />;

  const { device: slug } = await params;
  const device = windowsDeviceBySlug(slug);
  if (!device) notFound();
  const base = `/windows/${device.slug}`;

  const sp = await searchParams;
  const requested = Number(sp.runs);
  const page = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1;

  // Paginate on the server rather than fetching everything and slicing in the
  // browser: the log grows by one row a day forever, and a page number in the
  // URL is linkable. Page 1 is the default, so the common case has no query.
  const data = getSync(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(data.totalRuns / PAGE_SIZE));

  // A page number past the end (a stale bookmark, or runs pruned) would render
  // an empty table with no way back. Send it to the last real page instead.
  const safePage = Math.min(page, pageCount);
  const runs = page === safePage ? data.runs : getSync(PAGE_SIZE, (safePage - 1) * PAGE_SIZE).runs;

  const firstOnPage = (safePage - 1) * PAGE_SIZE + 1;
  const lastOnPage = Math.min(safePage * PAGE_SIZE, data.totalRuns);
  const hours = data.hoursSinceSuccess;

  // 24h cadence, so ~36h is a missed run and 48h+ means something is wrong.
  // The task has StartWhenAvailable, so even a machine that was off should
  // catch up shortly after it is switched on.
  const stale = hours != null && hours > 48;
  const warn = hours != null && hours > 36 && !stale;
  const broken = data.consecutiveFailures >= 2;

  return (
    <>
      <div className="page-head">
        <h1>Sync Status</h1>
        <p>
          The reset-survival guarantee depends on the scheduled task actually
          running. This page is how a broken task gets noticed in time.
        </p>
      </div>

      {(stale || broken) && (
        <div className="alert animate-in" style={{ marginBottom: '1.15rem' }}>
          <div>
            <h2>{broken ? 'Collector is failing' : 'Collector may have stopped'}</h2>
            <p style={{ margin: '0.4rem 0 0', color: 'var(--text)' }}>
              {broken
                ? `The last ${data.consecutiveFailures} runs failed. New usage is not being saved, and SRUM evicts its own history after roughly 55 days.`
                : `No successful run in ${hours != null ? Math.round(hours) : '?'} hours. Expected cadence is daily.`}
            </p>
            <p style={{ margin: '0.6rem 0 0', color: 'var(--text-dim)', fontSize: 'var(--fs-small)' }}>
              Check <code className="mono">logs/collector-*.log</code>, then re-run{' '}
              <code className="mono">scripts\collector.ps1</code> from an elevated shell.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid--3" style={{ marginBottom: '1.15rem' }}>
        <Card delay={0}>
          <div className="stat-label">Last successful run</div>
          <div className="stat-value" style={{ marginTop: '0.5rem', color: stale || broken ? 'var(--danger)' : 'var(--accent-bright)', fontSize: '1.9rem' }}>
            {hours != null ? formatRelative(hours) : 'never'}
          </div>
          <div className="stat-sub">
            {data.lastSuccess ? formatDateTime(data.lastSuccess.startedAt) : 'no successful run recorded'}
          </div>
        </Card>

        <Card delay={70}>
          <div className="stat-label">Rows stored</div>
          <div className="stat-value" style={{ marginTop: '0.5rem', fontSize: '1.9rem' }}>
            {formatCount(data.totalRows)}
          </div>
          <div className="stat-sub">
            {data.coverage
              ? `${data.coverage.days} days · ${data.coverage.first} → ${data.coverage.last}`
              : '—'}
          </div>
        </Card>

        <Card delay={140}>
          <div className="stat-label">Last backup</div>
          <div className="stat-value" style={{ marginTop: '0.5rem', fontSize: '1.9rem', color: data.lastSuccess?.backupStatus === 'ok' ? 'var(--success)' : 'var(--text-dim)' }}>
            {data.lastSuccess?.backupStatus === 'ok' ? 'OK' : (data.lastSuccess?.backupStatus ?? '—')}
          </div>
          <div className="stat-sub">Restore from the backup, not the live file</div>
        </Card>
      </div>

      <Card delay={210} hover={false}>
        <CardTitle
          sub="A run that inserts 0 rows is normal and healthy — it means nothing new had accumulated since the last one."
          aside={
            data.totalRuns > 0 && (
              <span className="callout-sub" style={{ whiteSpace: 'nowrap' }}>
                {firstOnPage}&ndash;{lastOnPage} of {data.totalRuns}
              </span>
            )
          }
        >
          Run history
        </CardTitle>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Status</th>
                <th className="num">Read</th>
                <th className="num">New</th>
                <th className="num">Duplicate</th>
                <th className="num">Took</th>
                <th>Backup</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => (
                <tr key={r.id} className="animate-in" style={{ animationDelay: `${Math.min(i * 18, 360)}ms` }}>
                  <td className="mono" style={{ fontSize: 'var(--fs-small)' }}>{formatDateTime(r.startedAt)}</td>
                  <td>
                    <span className={`badge ${r.status === 'success' ? 'badge--ok' : r.status === 'failed' ? 'badge--bad' : ''}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="num">{formatCount(r.rowsRead)}</td>
                  <td className="num" style={{ color: r.rowsInserted > 0 ? 'var(--accent-bright)' : 'var(--text-faint)', fontWeight: r.rowsInserted > 0 ? 600 : 400 }}>
                    {r.rowsInserted > 0 ? `+${formatCount(r.rowsInserted)}` : '0'}
                  </td>
                  <td className="num" style={{ color: 'var(--text-faint)' }}>{formatCount(r.rowsSkipped)}</td>
                  <td className="num" style={{ color: 'var(--text-dim)' }}>{formatDuration(r.durationMs)}</td>
                  <td style={{ color: r.backupStatus === 'ok' ? 'var(--success)' : 'var(--text-dim)', fontSize: 'var(--fs-small)' }}>
                    {r.backupStatus ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className="pager">
            <Link
              href={safePage > 1 ? `${base}/sync?runs=${safePage - 1}` : `${base}/sync`}
              className="chip"
              aria-disabled={safePage === 1}
              data-disabled={safePage === 1}
            >
              &larr; Newer
            </Link>
            <span className="pager-page">Page {safePage} of {pageCount}</span>
            <Link
              href={`${base}/sync?runs=${Math.min(pageCount, safePage + 1)}`}
              className="chip"
              aria-disabled={safePage === pageCount}
              data-disabled={safePage === pageCount}
            >
              Older &rarr;
            </Link>
          </div>
        )}

        {runs.some((r) => r.error) && (
          <div style={{ marginTop: '1.4rem' }}>
            <div className="stat-label" style={{ marginBottom: '0.6rem' }}>Recent errors</div>
            {runs.filter((r) => r.error).slice(0, 5).map((r) => (
              <div key={r.id} className="mono" style={{
                fontSize: 'var(--fs-small)', color: 'var(--danger)',
                padding: '0.6rem 0.8rem', marginBottom: '0.4rem',
                background: 'var(--danger-dim)', borderRadius: 'var(--radius-sm)',
              }}>
                <span style={{ color: 'var(--text-faint)' }}>{formatDateTime(r.startedAt)}</span> — {r.error}
              </div>
            ))}
          </div>
        )}
      </Card>

      {warn && (
        <p style={{ marginTop: '1.15rem', color: 'var(--text-dim)', fontSize: 'var(--fs-small)' }}>
          Last run was {Math.round(hours!)} hours ago — slightly over the daily cadence, but the
          task is set to catch up when the machine is next on, so this usually resolves itself.
        </p>
      )}
    </>
  );
}
