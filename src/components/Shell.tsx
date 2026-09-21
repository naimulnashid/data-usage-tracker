'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { deviceOf } from '@/lib/accent';
import type { ProfileOption } from '@/lib/queries';
import { Sidebar, type SidebarDevice } from './Sidebar';
import { Nav } from './Nav';
import { ScopeBar } from './ScopeBar';
import { SyncButton } from './SyncButton';
import { SignOutButton } from './SignOutButton';
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
 * - **Which controls apply.** The page tabs come from the active device, and
 *   the network scope selector and the Sync button
 *   drive the Windows collector. On the Android pages they would be controls
 *   for a machine you are not looking at, so they are not rendered at all
 *   rather than rendered inert.
 */
export function Shell({
  profiles, phones, laptop, children,
}: {
  profiles: ProfileOption[];
  /** The laptop, as a slug and a label. From config; there is only ever one. */
  laptop: SidebarDevice;
  /** Android devices that have reported, for the sidebar. */
  phones: SidebarDevice[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const device = deviceOf(pathname);
  const isWindows = device === 'windows';

  return (
    <div className="shell" data-device={device}>
      {/* First in tab order: past the sidebar and the top bar to the page. */}
      <a href="#content" className="skip-link">Skip to content</a>
      <Sidebar phones={phones} laptop={laptop} />
      <div className="shell-body">
        <header className="topbar">
          <Nav />
          <div className="topbar-right">
            {/* The Sync button runs the WINDOWS collector, so it is the one
                control that genuinely does not apply on the phone's pages -
                the phone pushes on its own schedule and there is nothing here
                to trigger. */}
            {isWindows && <SyncButton />}
            {/* The range chips apply to both devices. The network selector
                inside ScopeBar hides itself when there is nothing to pick, so
                passing an empty list on Android leaves exactly the chips.

                ScopeBar reads useSearchParams, which opts any page containing
                it out of static prerendering. Without this boundary the
                built-in /_not-found page fails to prerender. */}
            <Suspense fallback={null}>
              <ScopeBar profiles={isWindows ? profiles : []} />
            </Suspense>
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
