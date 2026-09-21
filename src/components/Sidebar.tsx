'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { deviceOf } from '@/lib/accent';
import { LaptopIcon, PhoneIcon, MenuIcon } from './DeviceIcons';

const STORAGE_KEY = 'data-usage.sidebar-collapsed';

export interface SidebarDevice {
  slug: string;
  label: string;
}

/**
 * Device switcher, and only that.
 *
 * The sidebar answers "which machine". The page tabs -- Overview, By App, Sync
 * Status -- answer "which view of it", and live in the top bar. Two different
 * questions; folding the second into the first made the sidebar re-render its
 * own contents on every page change, which reads as navigation moving under you.
 *
 * The phones come from the database rather than a constant, because there can
 * be any number of them and the dashboard should not need editing to show one.
 */
export function Sidebar({
  phones, laptop,
}: {
  phones: SidebarDevice[];
  laptop: SidebarDevice;
}) {
  const pathname = usePathname();
  const active = deviceOf(pathname);
  // Both platforms are `/<platform>/<slug>/...`, so one rule reads either.
  const activeSlug = pathname.split('/')[2];

  /*
    Starts expanded and corrects itself after mount.

    Reading localStorage during render gives the server one answer and the
    client another, which React reports as a hydration mismatch. The flash of an
    expanded rail on a collapsed setup lasts one frame; the alternative --
    suppressing hydration warnings -- hides real mismatches later.
  */
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // Private windows and blocked site data throw on access. A sidebar that
      // is merely always expanded beats a crash.
    }
    setReady(true);
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* see above */ }
  };

  return (
    <aside
      className="sidebar"
      data-collapsed={collapsed}
      // Until the stored value is read, skip the width transition, or a
      // collapsed sidebar visibly slides shut on every page load.
      data-ready={ready}
    >
      <div className="sidebar-head">
        <button
          className="sidebar-burger"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <MenuIcon />
        </button>
        <Link href="/" className="brand sidebar-label" title="Data Usage" aria-label="Data Usage, home">
          {/* Same file the browser uses for the tab icon, so the mark and the
              favicon cannot drift apart. */}
          <img src="/icon.svg" alt="" className="brand-mark" width={20} height={20} />
          <span>Data Usage</span>
        </Link>
      </div>

      <nav className="sidebar-nav" aria-label="Devices">
        <Link
          href={`/windows/${laptop.slug}`}
          className="side-device"
          // Scopes the accent variables to this entry, so each row carries its
          // own device's colour even while you are looking at another. Which
          // machine you are about to switch to is legible before you click.
          data-device="windows"
          data-active={active === 'windows' && activeSlug === laptop.slug}
          aria-current={active === 'windows' && activeSlug === laptop.slug ? 'page' : undefined}
          // Collapsed, the visible label is display:none and leaves the tree;
          // without this the link's only name would be its title tooltip.
          aria-label={`${laptop.label}, Windows`}
          title={`${laptop.label} - Windows`}
        >
          <span className="side-device-icon"><LaptopIcon size={20} /></span>
          <span className="sidebar-label side-device-text">
            <span className="side-device-name">{laptop.label}</span>
            <span className="side-device-sub">Windows</span>
          </span>
        </Link>

        {phones.map((p) => (
          <Link
            key={p.slug}
            href={`/android/${p.slug}`}
            className="side-device"
            data-device="android"
            data-active={active === 'android' && activeSlug === p.slug}
            aria-current={active === 'android' && activeSlug === p.slug ? 'page' : undefined}
            aria-label={`${p.label}, Android`}
            title={`${p.label} - Android`}
          >
            <span className="side-device-icon"><PhoneIcon size={20} /></span>
            <span className="sidebar-label side-device-text">
              <span className="side-device-name">{p.label}</span>
              <span className="side-device-sub">Android</span>
            </span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
