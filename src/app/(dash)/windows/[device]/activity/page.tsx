import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { windowsTitle } from '@/lib/page-title';
import {
  getHeatmap, getRowCount, windowsDeviceBySlug, databaseExists,
} from '@/lib/queries';
import { Card, CardTitle } from '@/components/Card';
import { ExpandedHeatmap } from '@/components/ActivityHeatmap';
import { EmptyState, NoDataInScope } from '@/components/EmptyState';
import { scopeQuery } from '@/lib/scope';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  const { device } = await params;
  return windowsTitle(device, 'Activity');
}

/**
 * The overview's Activity card, expanded to the whole history.
 *
 * Reached from that card's "Expand" button, which appears only once there is
 * more than it can show -- but the page itself renders for any history, so a
 * bookmark keeps working. Honours the network scope like the card does, and
 * ignores the day range like the card does.
 */
export default async function ActivityPage({
  params, searchParams,
}: {
  params: Promise<{ device: string }>;
  searchParams: Promise<{ days?: string; profile?: string }>;
}) {
  if (!databaseExists()) return <EmptyState />;

  const { device: slug } = await params;
  const device = windowsDeviceBySlug(slug);
  if (!device) notFound();
  const base = `/windows/${device.slug}`;

  const sp = await searchParams;
  const profileId = sp.profile ?? null;
  const heatmap = getHeatmap(profileId, null);

  if (heatmap.length === 0) {
    return getRowCount() === 0
      ? <EmptyState />
      : <NoDataInScope scoped={profileId !== null} home={base} />;
  }

  return (
    <>
      <div className="page-head">
        <Link href={`${base}${scopeQuery(sp)}`} className="back-link">&larr; Overview</Link>
        <h1 style={{ marginTop: '0.6rem' }}>Activity</h1>
        <p>Every day held, six months to a row, on one colour scale</p>
      </div>

      <Card hover={false}>
        <CardTitle sub="Daily totals. Outlined days were never collected - before collection started, or lost before a run read them - which is not the same as a quiet day.">
          {device.label}
        </CardTitle>
        <ExpandedHeatmap daily={heatmap} earliest={heatmap[0]!.date} />
      </Card>
    </>
  );
}
