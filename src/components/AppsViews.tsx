'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { AppIconMap } from '@/lib/app-icons';
import { formatBytes } from '@/lib/format';
import { AppIcon } from './AppIcon';
import { GridIcon, TableIcon } from './Icons';

export type AppsView = 'table' | 'grid';

const VIEW_KEY = 'du-apps-view';

/**
 * Table or grid, remembered per browser: a viewing preference, like the
 * theme, so localStorage rather than the database. Read in an effect, never
 * during render, so the server and the first client render agree.
 */
export function useAppsView(): [AppsView, (v: AppsView) => void] {
  const [view, setView] = useState<AppsView>('table');
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === 'grid') setView('grid');
    } catch {
      /* storage blocked: the table it is */
    }
  }, []);
  const choose = (v: AppsView) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* not remembered */ }
  };
  return [view, choose];
}

/** The two-way switch in the Apps card's head. */
export function ViewToggle({ view, onChange }: { view: AppsView; onChange: (v: AppsView) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="Show apps as">
      <button type="button" data-active={view === 'table'} aria-pressed={view === 'table'} onClick={() => onChange('table')} title="Table">
        <TableIcon size={15} /><span>Table</span>
      </button>
      <button type="button" data-active={view === 'grid'} aria-pressed={view === 'grid'} onClick={() => onChange('grid')} title="Grid">
        <GridIcon size={15} /><span>Grid</span>
      </button>
    </div>
  );
}

/**
 * One app as a card: its logo large, then the figures. The whole card opens
 * the detail page when the app has one; the name is the link for keyboards
 * and assistive tech, and clicks on the card's own controls are left alone.
 */
export function AppCard({
  name, href, color, icons, sent, received, total, days, badges, actions, title, hidden, index,
}: {
  name: string;
  href?: string;
  color: string;
  icons: AppIconMap;
  sent: number;
  received: number;
  total: number;
  days: number;
  badges?: ReactNode;
  /** The menu. */
  actions: ReactNode;
  /** The name, a link when the app has a detail page. */
  title: ReactNode;
  hidden?: boolean;
  index: number;
}) {
  const router = useRouter();
  return (
    <div
      className={`app-card${href ? ' app-card--link' : ''}${hidden ? ' app-card--hidden' : ''} animate-in`}
      style={{ animationDelay: `${Math.min(index * 22, 360)}ms` }}
      onClick={(e) => {
        if (!href) return;
        if ((e.target as HTMLElement).closest('a, button, input, select, form, label, dialog')) return;
        router.push(href);
      }}
    >
      <div className="app-card-top">
        <AppIcon name={name} color={color} icons={icons} size={52} />
        <span className="app-card-actions">{actions}</span>
      </div>
      <div className="app-card-name">{title}</div>
      {badges && <div className="app-card-badges">{badges}</div>}
      <div className="app-card-total">{formatBytes(total)}</div>
      <div className="app-card-io">
        <span title="Uploaded">&uarr; {formatBytes(sent)}</span>
        <span title="Downloaded">&darr; {formatBytes(received)}</span>
      </div>
      <div className="app-card-days">{days} active {days === 1 ? 'day' : 'days'}</div>
    </div>
  );
}

/** "3 hidden · Show them" under the list, when the user has hidden any. */
export function HiddenToggle({
  count, shown, onToggle,
}: { count: number; shown: boolean; onToggle: () => void }) {
  if (count === 0) return null;
  return (
    <button type="button" className="chip" onClick={onToggle} aria-pressed={shown}>
      {shown ? `Leave out the ${count} hidden` : `Show ${count} hidden`}
    </button>
  );
}
