'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { RANGES, DEFAULT_DAYS, rangeLabel } from '@/lib/scope';


/**
 * The window length, kept in the URL.
 *
 * In the query string rather than component state so a view is linkable and
 * survives a refresh, and so every page reads the same range without a shared
 * client store.
 *
 * This used to carry a network selector too, scoping every Windows page to one
 * `L2ProfileId`. It was removed on 2026-09-30 at the user's request: the
 * overview's "Where it went" card answers "how much on which network" directly,
 * the way the phone pages always have, without a filter that silently changed
 * every number on every page.
 */
export function ScopeBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const days = Number(params.get('days') ?? DEFAULT_DAYS);

  const setDays = useCallback(
    (value: number) => {
      const next = new URLSearchParams(params.toString());
      next.set('days', String(value));
      // A `?profile=` from an old bookmark is dead weight; drop it on the way.
      next.delete('profile');
      startTransition(() => router.push(`${pathname}?${next.toString()}`));
    },
    [params, pathname, router],
  );

  return (
    <div
      className="scope-bar"
      // Layout lives in `.scope-bar`, not here: an inline style cannot be
      // reached by the wrapping rules the narrow-screen top bar depends on.
      // Only the pending fade stays inline, because it is component state.
      style={{ opacity: pending ? 0.55 : 1, transition: 'opacity 200ms var(--ease)' }}
    >
      <div className="scope-ranges">
        {RANGES.map((d) => (
          <button
            key={d}
            className="chip"
            data-active={days === d}
            onClick={() => setDays(d)}
            aria-pressed={days === d}
          >
            {rangeLabel(d)}
          </button>
        ))}
      </div>
    </div>
  );
}
