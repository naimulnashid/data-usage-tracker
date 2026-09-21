'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';

/**
 * What a dashboard page shows when rendering it throws.
 *
 * Inside the (dash) group, so the sidebar and the top bar survive and the
 * reader can simply go elsewhere. Without this, any server error -- a locked
 * or damaged database, a query bug -- replaced the whole window with Next's
 * bare "Application error" text and no way back.
 *
 * "Try again" refreshes the SERVER render as well as resetting this boundary:
 * the failure happened in a server component, so `reset()` alone would retry
 * the client side and show the same error again.
 */
export default function DashError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="empty" role="alert">
      <h1 style={{ marginBottom: '0.8rem' }}>This page could not load</h1>
      <p style={{ maxWidth: 560, margin: '0 auto 1.6rem' }}>
        Something failed while reading the usage database. Pages only ever read
        it, so nothing stored has changed. The details are in
        {' '}<code className="mono">logs\dashboard.log</code>
        {error.digest ? <>, under reference <code className="mono">{error.digest}</code></> : null}.
      </p>
      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="chip"
          disabled={retrying}
          onClick={() => startTransition(() => { router.refresh(); reset(); })}
        >
          {retrying ? 'Retrying' : 'Try again'}
        </button>
        <Link href="/" className="chip">Go to the overview</Link>
      </div>
    </div>
  );
}
