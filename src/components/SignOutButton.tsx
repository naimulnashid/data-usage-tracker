'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Ends the session on this device.
 *
 * Clears the cookie server-side rather than client-side: the session cookie is
 * httpOnly, so the browser cannot delete it from script.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/login', { method: 'DELETE' });
      router.replace('/login');
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      className="chip icon-chip"
      onClick={() => void signOut()}
      disabled={busy}
      title="Sign out of this device"
      aria-label="Sign out"
    >
      {/* Door-with-arrow. Inline so it inherits currentColor and needs no asset. */}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    </button>
  );
}
