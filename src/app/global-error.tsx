'use client';

import './globals.css';
import { accentStyleSheet } from '@/lib/accent';

/**
 * The last resort: an error in the root layout itself.
 *
 * This REPLACES the root layout, so it brings its own <html>, the global
 * styles, and the accent variables the root layout would normally inline --
 * without them the button below has no fill at all.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Error · Data Usage</title>
        <style dangerouslySetInnerHTML={{ __html: accentStyleSheet() }} />
      </head>
      <body>
        <div className="login-screen">
          <div className="login-card" role="alert">
            <h1 className="login-title">The dashboard hit an error</h1>
            <p className="login-sub">
              Nothing stored has changed. The details are in logs\dashboard.log.
            </p>
            <button type="button" className="login-button" onClick={() => reset()}>
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
