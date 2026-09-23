import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { androidTitle } from '@/lib/page-title';
import { getAndroidHeatmap, deviceBySlug, androidReady } from '@/lib/android-queries';
import { Card, CardTitle } from '@/components/Card';
import { ExpandedHeatmap } from '@/components/ActivityHeatmap';
import { AndroidEmpty } from '@/components/AndroidEmpty';
import { scopeQuery } from '@/lib/scope';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  const { device } = await params;
  return androidTitle(device, 'Activity');
}

/**
 * The phone overview's Activity card, expanded to the whole history. Same page
 * as the laptop's; see `windows/[device]/activity/page.tsx`.
 */
export default async function AndroidActivityPage({
  params, searchParams,
}: {
  params: Promise<{ device: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  if (!androidReady()) return <AndroidEmpty />;

  const { device: slug } = await params;
  const device = deviceBySlug(slug);
  if (!device) notFound();
  const base = `/android/${device.slug}`;

  const sp = await searchParams;
  const heatmap = getAndroidHeatmap(device.deviceId);

  return (
    <>
      <div className="page-head">
        <Link href={`${base}${scopeQuery(sp)}`} className="back-link">&larr; Overview</Link>
        <h1 style={{ marginTop: '0.6rem' }}>Activity</h1>
        <p>Every day held, six months to a row, on one colour scale</p>
      </div>

      <Card hover={false}>
        <CardTitle sub="Daily totals. Outlined days are before this phone started reporting - no data was recorded, which is not the same as a quiet day.">
          {device.label}
        </CardTitle>
        <ExpandedHeatmap daily={heatmap} earliest={heatmap[0]?.date ?? null} />
      </Card>
    </>
  );
}
