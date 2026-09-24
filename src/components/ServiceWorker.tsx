'use client';

import { useEffect } from 'react';

/**
 * Registers `public/sw.js`, which serves an offline page and caches nothing
 * else -- see the comment at its top for why.
 *
 * `navigator.serviceWorker` exists only in a secure context, so over plain
 * HTTP on the LAN this does nothing, which is correct: the worker is only
 * useful to an installed app, and an insecure origin cannot install one.
 * Production only, so `next dev` never ends up behind a worker.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Nothing to tell the reader: the dashboard works the same without it.
    });
  }, []);
  return null;
}
