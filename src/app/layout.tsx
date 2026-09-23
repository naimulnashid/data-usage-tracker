import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { accentStyleSheet } from '@/lib/accent';

export const metadata: Metadata = {
  // Pages name themselves (lib/page-title.ts); this adds the suffix, and is
  // the whole title for anything that does not.
  title: { default: 'Data Usage', template: '%s · Data Usage' },
  description: 'Local dashboard over Windows per-app network usage history.',
};

/**
 * Every device gets the desktop layout: a phone lays the page out 1024px wide
 * and zooms it to fit, as its browser's own "desktop site" mode does. Next's
 * default is `width=device-width`, which gave a phone a 375px layout.
 *
 * `width` alone, with no initial scale, so the browser fits the whole width
 * to the screen and pinch-zoom still works. Next adds `initial-scale=1` by
 * default, which on a phone opens the page at 100% -- the left 390px of it --
 * so it is cleared explicitly: Next copies every key a layout names, and
 * drops an undefined one when it writes the tag. On a real desktop window
 * none of this changes anything: desktop browsers ignore the viewport meta.
 */
export const viewport: Viewport = { width: 1024, initialScale: undefined };

/**
 * Root layout: fonts, globals, nothing else.
 *
 * The dashboard chrome (sidebar, top bar, scope selector) lives in the `(dash)`
 * route group instead, so `/login` can render without it. That group changes no
 * URLs -- it exists purely so the login screen does not inherit a shell that
 * queries the database and renders navigation the visitor cannot use yet.
 *
 * The accent layer is inlined here rather than written into `globals.css`
 * because it is generated from `accent.ts`, which is the one place any accent
 * colour is defined. Inlining it in <head> also means the correct accent is
 * painted with the first frame, with no flash of the default blue.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: accentStyleSheet() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
