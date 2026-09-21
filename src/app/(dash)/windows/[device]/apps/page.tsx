import type { Metadata } from 'next';
import { windowsTitle } from '@/lib/page-title';
import { notFound } from 'next/navigation';
import {
  getByApp, getAppColorMap, getRowCount, windowsDeviceBySlug, databaseExists, type Scope,
} from '@/lib/queries';
import { getAppIconMap } from '@/lib/app-icons-server';
import { Card, CardTitle } from '@/components/Card';
import { parseDays } from '@/lib/scope';
import { TopAppsChart } from '@/components/Charts';
import { AppTable } from '@/components/AppTable';
import { EmptyState, NoDataInScope } from '@/components/EmptyState';
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
  const scope: Scope = { days: parseDays(sp.days), profileId: sp.profile ?? null };
  const data = getByApp(scope);

  // Carry the active scope into detail links, so opening an app does not
  // silently reset the range the user was looking at.
  const qs = new URLSearchParams();
  if (sp.days) qs.set('days', sp.days);
  if (sp.profile) qs.set('profile', sp.profile);
  const search = qs.toString() ? `?${qs.toString()}` : '';
  const colors = getAppColorMap();
  const icons = getAppIconMap(device.slug);

  if (data.apps.length === 0) {
    // Distinguish an empty database from an empty selection.
    return getRowCount() === 0
      ? <EmptyState />
      : <NoDataInScope scoped={scope.profileId !== null} home={base} />;
  }

  const top = data.apps.slice(0, 10).map((a) => ({
    name: a.name, total: a.total, sent: a.sent, received: a.received, share: a.share,
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

      <Card delay={90} hover={false}>
        <CardTitle
          sub={
            data.unattributed > 0
              ? 'Percentages are of attributed traffic, so they will not quite reach the headline total — the remainder is traffic SRUM could not attribute to a process.'
              : undefined
          }
        >
          Apps
        </CardTitle>
        <AppTable apps={data.apps} colors={colors} icons={icons} search={search} base={base} />
      </Card>
    </>
  );
}
