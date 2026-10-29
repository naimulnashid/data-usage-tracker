import type { Metadata } from 'next';
import { androidTitle } from '@/lib/page-title';
import { notFound } from 'next/navigation';
import {
  getAndroidOverview, getAndroidAppColorMap, getAndroidColorOverrides, earnsAndroidDetailPage, deviceBySlug, androidReady, getAndroidAppNames,
} from '@/lib/android-queries';
import { getAppIconMap } from '@/lib/app-icons-server';
import { Card, CardTitle } from '@/components/Card';
import { TopAppsChart } from '@/components/Charts';
import { AndroidAppTable } from '@/components/AndroidAppTable';
import { AndroidEmpty } from '@/components/AndroidEmpty';
import { ALL_DAYS } from '@/lib/scope';
import { formatBytes, formatPercent } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * By App, matching the Windows page: a Top 10 chart, then the full table.
 *
 * Split off the Overview for the same reason it is split there -- the overview
 * answers "how much, and when", and a 125-row table is a different question
 * that was pushing everything else off the page.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  const { device } = await params;
  return androidTitle(device, 'By App');
}

export default async function AndroidAppsPage({
  params,
}: {
  params: Promise<{ device: string }>;
}) {
  if (!androidReady()) return <AndroidEmpty />;

  const { device: slug } = await params;
  const device = deviceBySlug(slug);
  if (!device) notFound();

  const data = getAndroidOverview(device.deviceId, ALL_DAYS);
  const colors = getAndroidAppColorMap(device.deviceId);
  const icons = getAppIconMap(device.slug, getAndroidAppNames(device.deviceId).values());

  const named = data.apps.reduce((a, x) => a + x.total, 0);
  // Hidden apps leave the Top 10 too; their bytes stay in every total.
  const top = data.apps.filter((a) => !a.hidden).slice(0, 10).map((a) => ({
    name: a.name, total: a.total, sent: a.tx, received: a.rx, share: a.share,
    href: earnsAndroidDetailPage(a.total, a.days) ? `/android/${slug}/apps/${a.uid}` : undefined,
  }));

  return (
    <>
      <div className="page-head">
        <h1>By App</h1>
        <p>
          {data.apps.length} apps · {formatBytes(named)} attributed
          {data.tethering > 0 && (
            <> · {formatBytes(data.tethering)} of tethering excluded
              ({formatPercent((data.tethering / (named + data.tethering)) * 100)})</>
          )}
        </p>
      </div>

      <Card delay={0} hover={false}>
        <CardTitle sub="Largest consumers. Each bar is download, then upload in a tint of the same colour.">
          Top 10
        </CardTitle>
        <TopAppsChart data={top} colors={colors} icons={icons} />
      </Card>

      <div style={{ height: '1.15rem' }} />

      <AndroidAppTable
        apps={data.apps} icons={icons} colors={colors}
        custom={[...getAndroidColorOverrides(device.deviceId).keys()]} base={`/android/${slug}`} device={slug}
        sub={'Names and labels come from the phone itself, so there is no guessing. '
          + 'A uid shared by several packages says so, and Android cannot split those figures.'}
      />
    </>
  );
}
