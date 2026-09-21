import { toLaptop } from '@/lib/legacy-urls';

export const dynamic = 'force-dynamic';

/** The laptop's old Sync Status URL. */
export default async function SyncRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  toLaptop('/sync', await searchParams);
}
