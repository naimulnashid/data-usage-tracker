import 'server-only';
import { redirect } from 'next/navigation';
import { windowsSlug } from '@/lib/queries';

/**
 * The old bare Windows URLs, kept alive as redirects.
 *
 * `/`, `/apps`, `/apps/<key>` and `/sync` were the laptop's addresses before
 * every device moved under `/<platform>/<slug>`. They are bookmarked, they are
 * written into notes and docs, and `/` in particular is what anyone
 * types at `localhost:7843`. Breaking them would have bought nothing.
 *
 * Two decisions worth keeping:
 *
 * - **These live OUTSIDE the `(dash)` route group**, for the same reason
 *   `/login` does: that group's layout mounts the sidebar and queries the
 *   database for the network-profile list. A page whose entire job is to issue
 *   a 307 must not run those queries first.
 * - **The query string is carried across.** `?days=` and `?profile=` are the
 *   scope the reader was looking at, and dropping them would silently reset the
 *   range on every followed bookmark -- which reads as the selector being
 *   broken rather than as a redirect having happened.
 */
export function toLaptop(
  path: string,
  search: Record<string, string | string[] | undefined>,
): never {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (typeof v === 'string') qs.set(k, v);
    else if (Array.isArray(v)) for (const one of v) qs.append(k, one);
  }
  const query = qs.toString();
  redirect(`/windows/${windowsSlug()}${path}${query ? `?${query}` : ''}`);
}
