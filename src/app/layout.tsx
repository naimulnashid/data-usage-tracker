import type { Metadata } from 'next';
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
