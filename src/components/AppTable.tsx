'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { AppRow } from '@/lib/queries';
import { colorOf, rawColorOf, type AppColorMap } from '@/lib/app-colors';
import type { AppIconMap } from '@/lib/app-icons';
import { AppIcon } from './AppIcon';
import { AppMenu } from './AppMenu';
import { AppCard, HiddenToggle, ViewToggle, useAppsView } from './AppsViews';
import { Card, CardTitle } from './Card';
import { RenameApp } from './RenameApp';
import { formatBytes, formatCount } from '@/lib/format';

type SortKey = 'name' | 'sent' | 'received' | 'total' | 'rows';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'App', numeric: false },
  { key: 'sent', label: 'Sent', numeric: true },
  { key: 'received', label: 'Received', numeric: true },
  { key: 'total', label: 'Total', numeric: true },
  { key: 'rows', label: 'Records', numeric: true },
];

/**
 * The laptop's Apps card: every app, as a table or as a grid of cards.
 *
 * The table carried a Share column until 3.7.0. The Top 10 above shows the
 * large shares and the small ones drew as nothing, so it went.
 */
export function AppTable({
  apps, colors, custom = [], icons, base, device, sub,
}: {
  apps: AppRow[];
  colors: AppColorMap;
  /** Family keys whose colour is the user's own. */
  custom?: string[];
  icons: AppIconMap;
  /** `/windows/<slug>`. Passed in because a device slug cannot be derived here. */
  base: string;
  /** The laptop's slug, for renames and the menu. */
  device: string;
  sub?: string;
}) {
  const [sort, setSort] = useState<SortKey>('total');
  const [asc, setAsc] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [view, setView] = useAppsView();

  const hiddenCount = apps.filter((a) => a.hidden).length;
  const listed = useMemo(() => (showHidden ? apps : apps.filter((a) => !a.hidden)), [apps, showHidden]);

  /*
    Default to the apps that earn a detail page.

    Hundreds of rows is not a list anyone reads; the long tail is installers
    that ran once and services that moved a few kilobytes. The apps with detail
    pages are the ones with something to look at, and they carry nearly all the
    traffic -- so the default view loses almost nothing while becoming legible.
    The full list is one click away, and the button says how many are left out
    rather than pretending they do not exist.
  */
  const visible = useMemo(
    () => (expanded ? listed : listed.filter((a) => a.detailed)),
    [listed, expanded],
  );

  const sorted = useMemo(() => {
    const copy = [...visible];
    copy.sort((a, b) => {
      const r = sort === 'name'
        ? a.name.localeCompare(b.name)
        : (a[sort] as number) - (b[sort] as number);
      return asc ? r : -r;
    });
    return copy;
  }, [visible, sort, asc]);

  const max = Math.max(...listed.map((a) => a.total), 1);
  const detailedCount = listed.filter((a) => a.detailed).length;
  const candidates = useMemo(() => apps.map((a) => ({ key: a.key, name: a.name })), [apps]);

  const toggle = (key: SortKey) => {
    if (key === sort) setAsc(!asc);
    else {
      setSort(key);
      // Names read best A-Z; magnitudes read best largest-first.
      setAsc(key === 'name');
    }
  };

  const hrefOf = (a: AppRow) => (a.detailed ? `${base}/apps/${encodeURIComponent(a.key)}` : undefined);

  /*
    Only apps that earn a detail page are links. The rest have nothing to show
    over time -- a one-day installer would be a page containing a single bar --
    so a dead link would be worse than no link. The title says which.
  */
  const nameOf = (a: AppRow) => {
    const href = hrefOf(a);
    return href ? (
      <Link href={href} className="app-name app-link" title={`${a.name} - open detail`}>{a.name}</Link>
    ) : (
      <span className="app-name" title={`${a.name} - too little activity for a detail page`}>{a.name}</span>
    );
  };
  const menuOf = (a: AppRow) => (
    <AppMenu platform="windows" device={device} appKey={a.key} name={a.name} hidden={a.hidden} candidates={candidates} />
  );
  const renameOf = (a: AppRow, children: React.ReactNode) => (
    <RenameApp
      variant="row" platform="windows" device={device}
      appKey={a.key} name={a.name} baseName={a.baseName}
      color={rawColorOf(colors, a.name)} customColor={custom.includes(a.key)}
    >
      {children}
    </RenameApp>
  );
  const kindOf = (a: AppRow) => a.kind !== 'path' && (
    <span className="badge app-kind">{a.kind === 'appx' ? 'store' : a.kind}</span>
  );

  return (
    <Card delay={90} hover={false}>
      <CardTitle sub={sub} aside={<ViewToggle view={view} onChange={setView} />}>
        Apps
      </CardTitle>

      {view === 'table' ? (
        // `app-table` fixes the column widths so the name column absorbs the
        // slack and truncates, instead of the table growing wider than the
        // panel and forcing a horizontal scroll to reach Total.
        <div className="table-wrap">
          <table className="app-table" id="app-table">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={`sortable ${c.numeric ? 'num' : ''}`}
                    data-sorted={sort === c.key}
                    aria-sort={sort === c.key ? (asc ? 'ascending' : 'descending') : 'none'}
                  >
                    {/* A button, not an onClick on the <th>: a header cell is not
                        focusable, so the sort was mouse-only (WCAG 2.1.1). */}
                    <button type="button" className="th-sort" onClick={() => toggle(c.key)}>
                      {c.label}
                      {sort === c.key && <span aria-hidden="true">{asc ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((a, i) => (
                <tr
                  key={a.key}
                  className={`animate-in${a.hidden ? ' row--hidden' : ''}`}
                  // Cap the stagger: past ~20 rows the delay stops reading as
                  // choreography and starts reading as lag.
                  style={{ animationDelay: `${Math.min(i * 18, 360)}ms` }}
                >
                  <td>
                    <span className="app-cell">
                      {/* The logo where we have one, the chart colour where we
                          do not -- the swatch is what ties this row to its band
                          in the stacked chart, so it is a fallback, not a gap. */}
                      <AppIcon name={a.name} color={colorOf(colors, a.name)} icons={icons} />
                      {renameOf(a, nameOf(a))}
                      {menuOf(a)}
                      {kindOf(a)}
                      {a.hidden && <span className="badge app-kind">hidden</span>}
                    </span>
                  </td>
                  <td className="num">{formatBytes(a.sent)}</td>
                  <td className="num">{formatBytes(a.received)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{formatBytes(a.total)}</td>
                  <td className="num" style={{ color: 'var(--text-faint)' }}>{formatCount(a.rows)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="app-grid" id="app-table">
          {sorted.map((a, i) => (
            <AppCard
              key={a.key}
              index={i}
              name={a.name}
              href={hrefOf(a)}
              color={colorOf(colors, a.name)}
              icons={icons}
              sent={a.sent}
              received={a.received}
              total={a.total}
              days={a.days}
              max={max}
              hidden={a.hidden}
              title={renameOf(a, nameOf(a))}
              actions={menuOf(a)}
              badges={(kindOf(a) || a.hidden) && <>{kindOf(a)}{a.hidden && <span className="badge app-kind">hidden</span>}</>}
            />
          ))}
        </div>
      )}

      {(listed.length > detailedCount || hiddenCount > 0) && <div className="table-more">
        {listed.length > detailedCount && (
          <>
            <button
              type="button"
              className="chip"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-controls="app-table"
            >
              {expanded
                ? `Show only the ${detailedCount} with detail pages`
                : `Show all ${listed.length} apps`}
            </button>
            <span className="table-more-note">
              {expanded
                ? `${listed.length - detailedCount} of these have too little activity for a detail page.`
                : `${listed.length - detailedCount} more moved too little to be worth a page.`}
            </span>
          </>
        )}
        <HiddenToggle count={hiddenCount} shown={showHidden} onToggle={() => setShowHidden(!showHidden)} />
      </div>}
    </Card>
  );
}
