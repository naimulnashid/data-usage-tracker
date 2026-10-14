'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { deviceOf } from '@/lib/accent';
import { Sidebar, type SidebarDevice } from './Sidebar';
import { Nav } from './Nav';
import { ScopeBar } from './ScopeBar';
import { SyncButton } from './SyncButton';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';
import { Footer } from './Footer';

/**
 * The dashboard shell: sidebar, top bar, content, footer.
 *
 * A client component because it needs the pathname for two things a server
 * layout cannot know:
 *
 * - **`data-device`**, which is what swaps the accent. Every accent in the app
 *   is a CSS variable defined in `accent.ts`, so this one attribute repaints
 *   buttons, active tabs, focus rings, chart strokes and the heat-map ramp.
 * - **Which controls apply.** The page tabs come from the active device. The
 *   Sync button drives the Windows collector, which also empties the phones'
 *   cloud inbox; without an inbox it would be a control for a machine you are
 *   not looking at on the Android pages, so there it is not rendered at all
 *   rather than rendered inert.
 */
export function Shell({
  phones, laptop, phoneSync, children,
}: {
  /** The laptop, as a slug and a label. From config; there is only ever one. */
  laptop: SidebarDevice;
  /** Android devices that have reported, for the sidebar. */
  phones: SidebarDevice[];
  /** A sync drains the cloud inbox, so the phone pages get the button too. */
  phoneSync: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const device = deviceOf(pathname);
  const showSync = device === 'windows' || phoneSync;

  return (
    <div className="shell" data-device={device}>
      {/* First in tab order: past the sidebar and the top bar to the page. */}
      <a href="#content" className="skip-link">Skip to content</a>
      <Sidebar phones={phones} laptop={laptop} />
      <div className="shell-body">
        <header className="topbar">
          <Nav />
          <div className="topbar-right">
            {/* A phone that posts straight to the dashboard has nothing a sync
                could fetch; one that posts to the cloud inbox waits for the
                next drain, which a sync runs now. */}
            {showSync && <SyncButton />}
            {/* The range chips apply to both devices.

                ScopeBar reads useSearchParams, which opts any page containing
                it out of static prerendering. Without this boundary the
                built-in /_not-found page fails to prerender. */}
            <Suspense fallback={null}>
              <ScopeBar />
            </Suspense>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>
        {/* tabIndex -1 so the skip link actually moves focus here, not just
            the scroll position. */}
        <main className="main" id="content" tabIndex={-1}>
          <div className="container">{children}</div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
