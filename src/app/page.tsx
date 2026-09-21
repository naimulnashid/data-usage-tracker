import { toLaptop } from '@/lib/legacy-urls';

export const dynamic = 'force-dynamic';

/** `localhost:7843` itself. Forwards to the laptop's overview. */
export default async function RootRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  toLaptop('', await searchParams);
}
