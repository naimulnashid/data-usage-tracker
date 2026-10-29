'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { AndroidApp } from '@/lib/android-queries';
import type { AppIconMap } from '@/lib/app-icons';
import { colorOf, rawColorOf, type AppColorMap } from '@/lib/app-colors';
import { AppIcon } from './AppIcon';
import { AppMenu } from './AppMenu';
import { AppCard, HiddenToggle, ViewToggle, useAppsView } from './AppsViews';
import { Card, CardTitle } from './Card';
import { formatBytes } from '@/lib/format';

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

/** Hundreds of packages is not a list anyone reads; 25 covers everything with a shape. */
const TOP = 25;

/**
 * Per-app usage on the phone, as a table or a grid, like the laptop's.
 *
 * What it carries that the Windows list does not is the two facts a uid
 * cannot express on its own -- that several packages share it, and that it
 * belongs to a cloned profile. The Share column went in 3.7.0 with the
 * laptop's.
 */
export function AndroidAppTable({
  apps, icons, colors, custom = [], base, device, sub,
}: {
  apps: AndroidApp[];
  icons: AppIconMap;
  colors: AppColorMap;
  /** uids (as text) whose colour is the user's own. */
  custom?: string[];
  /** `/android/<slug>`. Passed in because a device slug cannot be derived here. */
  base: string;
  /** The phone's slug, for renames and the menu. */
  device: string;
  sub?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [view, setView] = useAppsView();

  const hiddenCount = apps.filter((a) => a.hidden).length;
  const listed = useMemo(() => (showHidden ? apps : apps.filter((a) => !a.hidden)), [apps, showHidden]);
  const visible = useMemo(() => (expanded ? listed : listed.slice(0, TOP)), [listed, expanded]);
  const candidates = useMemo(() => apps.map((a) => ({ key: String(a.uid), name: a.name })), [apps]);

  const hrefOf = (a: AndroidApp) => (earnsDetail(a.total, a.days) ? `${base}/apps/${a.uid}` : undefined);
  // Only apps with a shape worth looking at are links. A uid that moved a few
  // kilobytes once would be a page of one bar, and a dead link is worse than
  // no link.
  const nameOf = (a: AndroidApp) => {
    const href = hrefOf(a);
    return href ? (
      <Link href={href} className="app-name app-link" title={`${a.name} - uid ${a.uid} - open detail`}>{a.name}</Link>
    ) : (
      <span className="app-name" title={`${a.name} - uid ${a.uid} - too little activity for a detail page`}>{a.name}</span>
    );
  };
  const menuOf = (a: AndroidApp) => (
    <AppMenu
      platform="android" device={device} appKey={String(a.uid)} name={a.name} hidden={a.hidden} candidates={candidates}
      baseName={a.baseName} color={rawColorOf(colors, a.name)} customColor={custom.includes(String(a.uid))}
    />
  );
  const badgesOf = (a: AndroidApp) => (
    <>
      {a.packages > 1 && (
        <span className="badge app-kind" title={`${a.packages} packages share uid ${a.uid}`}>+{a.packages - 1}</span>
      )}
      {a.profile > 0 && <span className="badge app-kind">clone</span>}
      {a.special && <span className="badge app-kind">system</span>}
      {a.hidden && <span className="badge app-kind">hidden</span>}
    </>
  );
  const hasBadges = (a: AndroidApp) => a.packages > 1 || a.profile > 0 || a.special || a.hidden;

  return (
    <Card delay={90} hover={false}>
      <CardTitle sub={sub} aside={<ViewToggle view={view} onChange={setView} />}>
        Apps
      </CardTitle>

      {view === 'table' ? (
        <div className="table-wrap">
          <table className="app-table" id="android-app-table">
            <thead>
              <tr>
                <th>App</th>
                <th className="num">Down</th>
                <th className="num">Up</th>
                <th className="num">Total</th>
                <th className="num">Days</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a, i) => (
                <tr
                  key={a.uid}
                  className={`animate-in${a.hidden ? ' row--hidden' : ''}`}
                  style={{ animationDelay: `${Math.min(i * 18, 360)}ms` }}
                >
                  <td>
                    <span className="app-cell">
                      <AppIcon name={a.name} color={colorOf(colors, a.name)} icons={icons} />
                      {nameOf(a)}
                      {menuOf(a)}
                      {badgesOf(a)}
                    </span>
                  </td>
                  <td className="num">{formatBytes(a.rx)}</td>
                  <td className="num">{formatBytes(a.tx)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{formatBytes(a.total)}</td>
                  <td className="num" style={{ color: 'var(--text-faint)' }}>{a.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="app-grid" id="android-app-table">
          {visible.map((a, i) => (
            <AppCard
              key={a.uid}
              index={i}
              name={a.name}
              href={hrefOf(a)}
              color={colorOf(colors, a.name)}
              icons={icons}
              sent={a.tx}
              received={a.rx}
              total={a.total}
              days={a.days}
              hidden={a.hidden}
              title={nameOf(a)}
              actions={menuOf(a)}
              badges={hasBadges(a) ? badgesOf(a) : undefined}
            />
          ))}
        </div>
      )}

      {(listed.length > TOP || hiddenCount > 0) && (
        <div className="table-more">
          {listed.length > TOP && (
            <>
              <button
                type="button"
                className="chip"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                aria-controls="android-app-table"
              >
                {expanded ? `Show the top ${TOP}` : `Show all ${listed.length} apps`}
              </button>
              {!expanded && <span className="table-more-note">{listed.length - TOP} more moved very little.</span>}
            </>
          )}
          <HiddenToggle count={hiddenCount} shown={showHidden} onToggle={() => setShowHidden(!showHidden)} />
        </div>
      )}
    </Card>
  );
}
