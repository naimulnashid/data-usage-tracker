import type { Metadata } from 'next';
import { windowsTitle } from '@/lib/page-title';
import { notFound } from 'next/navigation';
import {
  getByApp, getAppColorMap, getAppColorOverrides, windowsDeviceBySlug, databaseExists, getWindowsAppNames, type Scope,
} from '@/lib/queries';
import { getAppIconMap } from '@/lib/app-icons-server';
import { Card, CardTitle } from '@/components/Card';
import { ALL_DAYS } from '@/lib/scope';
import { TopAppsChart } from '@/components/Charts';
import { AppTable } from '@/components/AppTable';
import { EmptyState } from '@/components/EmptyState';
import { formatBytes, formatPercent } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  const { device } = await params;
  return windowsTitle(device, 'By App');
}

export default async function ByAppPage({
  params,
}: {
  params: Promise<{ device: string }>;
}) {
  if (!databaseExists()) return <EmptyState />;

  const { device: slug } = await params;
  const device = windowsDeviceBySlug(slug);
  if (!device) notFound();
  const base = `/windows/${device.slug}`;

  // All history: the page has no range of its own.
  const scope: Scope = { days: ALL_DAYS };
  const data = getByApp(scope);
  const colors = getAppColorMap();
  const icons = getAppIconMap(device.slug, getWindowsAppNames().values());

  if (data.apps.length === 0) return <EmptyState />;

  // Hidden apps leave the Top 10 too; their bytes stay in every total.
  const top = data.apps.filter((a) => !a.hidden).slice(0, 10).map((a) => ({
    name: a.name, total: a.total, sent: a.sent, received: a.received, share: a.share,
    href: a.detailed ? `${base}/apps/${encodeURIComponent(a.key)}` : undefined,
  }));

  return (
    <>
      <div className="page-head">
        <h1>By App</h1>
        <p>
          {data.apps.length} apps · {formatBytes(data.namedTotal)} attributed
          {data.unattributed > 0 && (
            <> · {formatBytes(data.unattributed)} unattributed
              ({formatPercent((data.unattributed / data.headlineTotal) * 100)})</>
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

      <AppTable apps={data.apps} colors={colors} custom={[...getAppColorOverrides().keys()]} icons={icons} base={base} device={device.slug} />
    </>
  );
}
