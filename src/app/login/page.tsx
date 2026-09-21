'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { safeNextPath } from '@/lib/safe-redirect';

/**
 * What the server's error codes mean, in words a reader can act on.
 *
 * "Wrong password" only for the one code that means it. This used to be the
 * default, so when the same-origin check refused every browser's login with a
 * 403, the page told the user their correct password was wrong.
 */
function describe(status: number, payload: { error?: string; retryAfterSeconds?: number }): string {
  switch (payload.error) {
    case 'wrong-password':
      return 'That password is not right.';
    case 'auth-not-configured':
      return 'No password is set on the server. Add DASHBOARD_PASSWORD to .env.local and restart.';
    case 'auth-password-too-short':
      return 'The server password is too short (under 12 characters), so the dashboard stays locked. Set a longer DASHBOARD_PASSWORD in .env.local and restart.';
    case 'too-many-attempts': {
      const s = payload.retryAfterSeconds ?? 60;
      return `Too many wrong attempts. Try again in ${s >= 90 ? `${Math.ceil(s / 60)} minutes` : `${s} seconds`}.`;
    }
    case 'cross-origin-request':
      return 'The server refused this request as coming from another site. Open the dashboard at its own address and try again.';
    default:
      return `Sign-in failed (HTTP ${status}). The dashboard log may say why.`;
  }
}

function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        // Same-origin paths only, so a crafted ?next= cannot bounce elsewhere.
        // See safe-redirect.ts for the backslash that the old check let through.
        // Read at submit, not through useSearchParams: that hook forced the
        // whole form behind a Suspense boundary whose fallback was nothing,
        // so the page was blank until JavaScript ran. Read here, the form
        // prerenders and paints on the first frame.
        const next = new URLSearchParams(window.location.search).get('next');
        router.replace(safeNextPath(next));
        router.refresh();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string; retryAfterSeconds?: number;
      };
      setError(describe(response.status, payload));
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <img src="/icon.svg" alt="" className="login-mark" width={40} height={40} />
      <h1 className="login-title">Data Usage</h1>
      <p className="login-sub">
        This dashboard shows which programs run on this machine and when, so it
        asks for the shared password first.
      </p>

      {/* A visible label, not a placeholder that vanishes on the first
          keystroke (WCAG 3.3.2); htmlFor gives the field its accessible name. */}
      <div className="login-field">
        <label htmlFor="password" className="login-label">Password</label>
        <input
          id="password"
          type="password"
          className="login-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          aria-invalid={error !== null}
          aria-describedby={error ? 'login-error' : undefined}
        />
      </div>

      <button className="login-button" type="submit" disabled={busy || password.length === 0}>
        {busy ? 'Checking...' : 'Unlock'}
      </button>

      {/* role="alert": a wrong password is otherwise announced as nothing at
          all -- the button just becomes clickable again. */}
      {error && <p id="login-error" className="login-error" role="alert">{error}</p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login-screen">
      <LoginForm />
    </div>
  );
}
