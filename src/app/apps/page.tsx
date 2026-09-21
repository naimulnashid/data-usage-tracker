import { toLaptop } from '@/lib/legacy-urls';

export const dynamic = 'force-dynamic';

/** The laptop's old By App URL. */
export default async function AppsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  toLaptop('/apps', await searchParams);
}
