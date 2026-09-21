import { redirect } from 'next/navigation';
import { windowsSlug } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * `/windows` names a platform, not a device, so it holds no content of its own
 * and forwards to the one laptop this install collects from.
 *
 * Mirrors `/android`, which forwards to whichever phone has moved the most
 * data. There is no choice to make here -- the collector snapshots THIS
 * machine's SRUM -- but the route exists for the same reason that one does:
 * it is the obvious thing to type, and the obvious thing for a URL that has
 * lost its slug to point at.
 */
export default function WindowsIndex() {
  redirect(`/windows/${windowsSlug()}`);
}
