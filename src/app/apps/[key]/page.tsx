import { toLaptop } from '@/lib/legacy-urls';

export const dynamic = 'force-dynamic';

/**
 * The laptop's old app-detail URL.
 *
 * `key` is re-encoded rather than passed through: Next has already decoded the
 * segment by the time it arrives here, and app keys carry spaces and dots.
 */
export default async function AppDetailRedirect({
  params, searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  toLaptop(`/apps/${encodeURIComponent(key)}`, await searchParams);
}
