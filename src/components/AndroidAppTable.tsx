'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { AndroidApp } from '@/lib/android-queries';
import type { AppIconMap } from '@/lib/app-icons';
import { colorOf, type AppColorMap } from '@/lib/app-colors';
import { AppIcon } from './AppIcon';
import { formatBytes, formatPercent } from '@/lib/format';

/*
  Eligibility is duplicated from `earnsAndroidDetailPage` rather than imported.

  That module is server-only -- it opens the database -- and this table is a
  client component. The thresholds are the same three numbers, and the detail
  page re-checks them server-side anyway, so a drift here can only ever produce
  a link to a page that says "not found", never a wrong figure.
*/
const DETAIL_MIN_BYTES = 100 * 1024 * 1024;
const DETAIL_MIN_DAYS = 14;
const DETAIL_PERSISTENT_MIN_BYTES = 5 * 1024 * 1024;

function earnsDetail(total: number, days: number): boolean {
  if (total >= DETAIL_MIN_BYTES) return true;
  return days >= DETAIL_MIN_DAYS && total >= DETAIL_PERSISTENT_MIN_BYTES;
}

/**
 * Per-app usage on the phone.
 *
 * Simpler than the Windows table on purpose: there is no detail page to link
 * to yet, and the phone's own labels mean there is no "kind" badge to explain
 * where a name came from. What it does carry that the Windows table does not is
 * the two facts a uid cannot express on its own -- that several packages share
 * it, and that it belongs to a cloned profile.
 */
export function AndroidAppTable({
  apps, icons, colors, search = '', base,
}: {
  apps: AndroidApp[];
  icons: AppIconMap;
  colors: AppColorMap;
  /** Current ?days, carried into detail links so the range survives. */
  search?: string;
  /** `/android/<slug>`. Passed in because a device slug cannot be derived here. */
  base: string;
}) {
  const [expanded, setExpanded] = useState(false);

  // Hundreds of packages is not a table anyone reads. The long tail here is system
  // services moving kilobytes; 25 covers everything with a shape.
  const visible = useMemo(() => (expanded ? apps : apps.slice(0, 25)), [apps, expanded]);
  const max = Math.max(...apps.map((a) => a.total), 1);

  return (
    <div className="table-wrap">
      <table className="app-table" id="android-app-table">
        <thead>
          <tr>
            <th>App</th>
            <th className="num">Down</th>
            <th className="num">Up</th>
            <th className="num">Total</th>
            <th className="num">Days</th>
            <th style={{ width: '22%' }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((a, i) => (
            <tr key={a.uid} className="animate-in" style={{ animationDelay: `${Math.min(i * 18, 360)}ms` }}>
              <td>
                <span className="app-cell">
                  <AppIcon name={a.name} color={colorOf(colors, a.name)} icons={icons} />
                  {/* Only apps with a shape worth looking at are links. A uid
                      that moved a few kilobytes once would be a page of one
                      bar, and a dead link is worse than no link. */}
                  {earnsDetail(a.total, a.days) ? (
                    <Link
                      href={`${base}/apps/${a.uid}${search}`}
                      className="app-name app-link"
                      title={`${a.name} - uid ${a.uid} - open detail`}
                    >
                      {a.name}
                    </Link>
                  ) : (
                    <span className="app-name" title={`${a.name} - uid ${a.uid} - too little activity for a detail page`}>
                      {a.name}
                    </span>
                  )}
                  {a.packages > 1 && (
                    <span className="badge app-kind" title={`${a.packages} packages share uid ${a.uid}`}>
                      +{a.packages - 1}
                    </span>
                  )}
                  {a.profile > 0 && <span className="badge app-kind">clone</span>}
                  {a.special && <span className="badge app-kind">system</span>}
                </span>
              </td>
              <td className="num">{formatBytes(a.rx)}</td>
              <td className="num">{formatBytes(a.tx)}</td>
              <td className="num" style={{ fontWeight: 600 }}>{formatBytes(a.total)}</td>
              <td className="num" style={{ color: 'var(--text-faint)' }}>{a.days}</td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                  <div className="bar-track" style={{ flex: 1, minWidth: 60 }}>
                    <div
                      className="bar-fill"
                      style={{
                        width: `${(a.total / max) * 100}%`,
                        background: colorOf(colors, a.name),
                        animationDelay: `${Math.min(i * 18, 360)}ms`,
                      }}
                    />
                  </div>
                  <span style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-small)', minWidth: 52, textAlign: 'right' }}>
                    {formatPercent(a.share)}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {apps.length > 25 && (
        <div className="table-more">
          <button
            type="button"
            className="chip"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls="android-app-table"
          >
            {expanded ? 'Show the top 25' : `Show all ${apps.length} apps`}
          </button>
          <span className="table-more-note">
            {expanded ? '' : `${apps.length - 25} more moved very little.`}
          </span>
        </div>
      )}
    </div>
  );
}
