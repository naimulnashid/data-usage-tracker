'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { AppRow } from '@/lib/queries';
import { colorOf, type AppColorMap } from '@/lib/app-colors';
import type { AppIconMap } from '@/lib/app-icons';
import { AppIcon } from './AppIcon';
import { formatBytes, formatCount, formatPercent } from '@/lib/format';

type SortKey = 'name' | 'sent' | 'received' | 'total' | 'rows';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'App', numeric: false },
  { key: 'sent', label: 'Sent', numeric: true },
  { key: 'received', label: 'Received', numeric: true },
  { key: 'total', label: 'Total', numeric: true },
  { key: 'rows', label: 'Records', numeric: true },
];

export function AppTable({
  apps, colors, icons, search = '', base,
}: {
  apps: AppRow[];
  colors: AppColorMap;
  icons: AppIconMap;
  /** Current ?days/?profile, carried into detail links so scope survives. */
  search?: string;
  /** `/windows/<slug>`. Passed in because a device slug cannot be derived here. */
  base: string;
}) {
  const [sort, setSort] = useState<SortKey>('total');
  const [asc, setAsc] = useState(false);
  const [expanded, setExpanded] = useState(false);

  /*
    Default to the apps that earn a detail page.

    Hundreds of rows is not a table anyone reads; the long tail is installers
    that ran once and services that moved a few kilobytes. The apps with detail
    pages are the ones with something to look at, and they carry nearly all the
    traffic -- so the default view loses almost nothing while becoming legible.
    The full list is one click away, and the button says how many are hidden
    rather than pretending they do not exist.
  */
  const visible = useMemo(
    () => (expanded ? apps : apps.filter((a) => a.detailed)),
    [apps, expanded],
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

  // Scale the share bars against the widest row in the FULL set, so a row's bar
  // does not change length when the table is expanded.
  const max = Math.max(...apps.map((a) => a.total), 1);
  const detailedCount = apps.filter((a) => a.detailed).length;

  const toggle = (key: SortKey) => {
    if (key === sort) setAsc(!asc);
    else {
      setSort(key);
      // Names read best A-Z; magnitudes read best largest-first.
      setAsc(key === 'name');
    }
  };

  return (
    // `app-table` fixes the column widths so the name column absorbs the
    // slack and truncates, instead of the table growing wider than the panel
    // and forcing a horizontal scroll to reach Total and Share.
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
            <th style={{ width: '22%' }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a, i) => (
            <tr
              key={a.key}
              className="animate-in"
              // Cap the stagger: past ~20 rows the delay stops reading as
              // choreography and starts reading as lag.
              style={{ animationDelay: `${Math.min(i * 18, 360)}ms` }}
            >
              <td>
                <span className="app-cell">
                  {/* The logo where we have one, the chart colour where we do
                      not -- the swatch is what ties this row to its band in the
                      stacked chart, so it is a fallback, not a gap. */}
                  <AppIcon name={a.name} color={colorOf(colors, a.name)} icons={icons} />
                  {/* title carries the full name, so truncation costs nothing. */}
                  {/*
                    Only apps that earn a detail page are links. The rest have
                    nothing to show over time -- a one-day installer would be a
                    page containing a single bar -- so a dead link would be
                    worse than no link. The title says which.
                  */}
                  {a.detailed ? (
                    <Link
                      href={`${base}/apps/${encodeURIComponent(a.key)}${search}`}
                      className="app-name app-link"
                      title={`${a.name} - open detail`}
                    >
                      {a.name}
                    </Link>
                  ) : (
                    <span
                      className="app-name"
                      title={`${a.name} - too little activity for a detail page`}
                    >
                      {a.name}
                    </span>
                  )}
                  {a.kind !== 'path' && (
                    <span className="badge app-kind">
                      {a.kind === 'appx' ? 'store' : a.kind}
                    </span>
                  )}
                </span>
              </td>
              <td className="num">{formatBytes(a.sent)}</td>
              <td className="num">{formatBytes(a.received)}</td>
              <td className="num" style={{ fontWeight: 600 }}>{formatBytes(a.total)}</td>
              <td className="num" style={{ color: 'var(--text-faint)' }}>{formatCount(a.rows)}</td>
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

      {apps.length > detailedCount && (
        <div className="table-more">
          <button
            type="button"
            className="chip"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls="app-table"
          >
            {expanded
              ? `Show only the ${detailedCount} with detail pages`
              : `Show all ${apps.length} apps`}
          </button>
          <span className="table-more-note">
            {expanded
              ? `${apps.length - detailedCount} of these have too little activity for a detail page.`
              : `${apps.length - detailedCount} more moved too little to be worth a page.`}
          </span>
        </div>
      )}
    </div>
  );
}
