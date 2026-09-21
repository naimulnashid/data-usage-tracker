import Link from 'next/link';

/**
 * A URL that matches no route at all.
 *
 * Outside the dashboard shell -- the shell queries the database, and an
 * address that means nothing should not -- so it borrows the login screen's
 * centred card. Only a signed-in visitor gets this far: the middleware sends
 * everyone else to /login first.
 */
export default function NotFound() {
  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="/icon.svg" alt="" className="login-mark" width={40} height={40} />
        <h1 className="login-title">Page not found</h1>
        <p className="login-sub">Nothing lives at this address.</p>
        <Link href="/" className="login-button" style={{ textAlign: 'center' }}>
          Go to the overview
        </Link>
      </div>
    </div>
  );
}
