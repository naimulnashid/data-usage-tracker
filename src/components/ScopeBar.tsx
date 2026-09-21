'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import type { ProfileOption } from '@/lib/queries';
import { formatBytes } from '@/lib/format';
import { RANGES, DEFAULT_DAYS, rangeLabel } from '@/lib/scope';


/**
 * Window length and network scope, both kept in the URL.
 *
 * In the query string rather than component state so a view is linkable and
 * survives a refresh, and so every page reads the same scope without a shared
 * client store.
 *
 * The network selector is not a nicety. Windows' own Data usage page is scoped
 * to a single profile, so an all-networks total here legitimately reads higher
 * than Windows whenever the machine has used more than one network. Without a
 * way to switch, that gap looks like a bug rather than a difference in scope.
 */
export function ScopeBar({ profiles }: { profiles: ProfileOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const days = Number(params.get('days') ?? DEFAULT_DAYS);
  const profile = params.get('profile') ?? '';

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
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
      {profiles.length > 1 && (
        <select
          className="chip"
          value={profile}
          onChange={(e) => setParam('profile', e.target.value || null)}
          aria-label="Network"
          style={{ paddingRight: '0.6rem' }}
        >
          <option value="">All networks</option>
          {/*
            A real SSID stands on its own. An unnamed profile gets "Wi-Fi,
            unnamed" plus its size -- the numbering that used to go here
            ("Wi-Fi 1", "Wi-Fi 2") was an index into a sorted list, so it
            silently meant a different network as soon as the ordering changed.
            The byte total is at least a stable, meaningful handle.

            Unnamed profiles fill in on their own: the collector records which
            network it is on each run, so a profile gets its name the next time
            the machine is connected to it during a collection.
          */}
          {profiles.map((p) => (
            <option key={p.id} value={p.id} title={p.aliases.length ? `Also seen as ${p.aliases.join(", ")}` : undefined}>
              {p.named ? p.label : `${p.label}, unnamed`}
              {p.aliases.length ? ` (+${p.aliases.length})` : ''}
              {` · ${formatBytes(p.bytes)}`}
            </option>
          ))}
        </select>
      )}

      <div className="scope-ranges">
        {RANGES.map((d) => (
          <button
            key={d}
            className="chip"
            data-active={days === d}
            onClick={() => setParam('days', String(d))}
            aria-pressed={days === d}
          >
            {rangeLabel(d)}
          </button>
        ))}
      </div>
    </div>
  );
}
