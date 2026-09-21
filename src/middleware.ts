import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE, configuredPassword, passwordProblem, verifySession, shouldRenew, issueSession,
} from '@/lib/auth';
import { safeNextPath } from '@/lib/safe-redirect';

/**
 * One gate in front of everything. Enforcing this here rather than per-page is
 * the whole point: a new route cannot forget to protect itself.
 *
 * The matcher lets Next's own static assets and the favicon through. Browsers
 * fetch `icon.svg` before any session exists, and gating it only makes the
 * login page render with a broken image -- it is a logo, it leaks nothing.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|icon.svg|favicon.ico).*)'],
};

/** Methods that change something, and so must come from this dashboard's own pages. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Did this request come from a page served by this dashboard?
 *
 * The session cookie is `SameSite=Lax`, which stops another SITE from riding
 * it -- but a site is scheme + host with the port ignored, so every
 * `localhost:*` page counts as same-site, the neighbouring dashboards on 7842
 * and 7844-7846 included. Any of them, or anything else served on localhost,
 * could POST to `/api/sync` with the cookie attached.
 *
 * `Sec-Fetch-Site` answers the question exactly and cannot be set by page
 * script. `same-origin` is our own pages; `none` is the user typing a URL or
 * a non-browser client. `Origin` is the fallback for browsers that predate
 * it. A request carrying neither is not from a browser, so it cannot be CSRF.
 */
function fromOwnOrigin(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  return !origin || origin === request.nextUrl.origin;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The phone authenticates with a bearer token, not a cookie, so there is no
  // ambient credential for another page to ride and nothing to check here.
  const isIngest = pathname === '/api/android/ingest';

  if (UNSAFE_METHODS.has(request.method) && pathname.startsWith('/api/') && !isIngest
      && !fromOwnOrigin(request)) {
    return NextResponse.json({ error: 'cross-origin-request' }, { status: 403 });
  }

  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next();

  // The phone has no browser session and never will. `/api/android/ingest`
  // authenticates with its own bearer token, which is STRICTER than this gate,
  // not exempt from it: the route fails closed on an unset token exactly as
  // this middleware does on an unset password. Kept to that one exact path so
  // adding a route under /api/android/ cannot accidentally inherit the bypass.
  if (isIngest) return NextResponse.next();

  const password = configuredPassword();
  const authorised =
    password !== undefined &&
    (await verifySession(password, request.cookies.get(SESSION_COOKIE)?.value));

  if (authorised) {
    // Slide the expiry forward on an active session, so a device you use
    // regularly is never signed out. Only once a day, so this is not a
    // Set-Cookie on every request.
    const cookie = request.cookies.get(SESSION_COOKIE)?.value;
    if (password !== undefined && shouldRenew(cookie)) {
      const response = NextResponse.next();
      const { value, maxAgeSeconds } = await issueSession(password);
      response.cookies.set(SESSION_COOKIE, value, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeSeconds,
        secure: false,
      });
      return response;
    }
    return NextResponse.next();
  }

  // Fail closed, and say so in a form the caller can actually read. An
  // unconfigured password is a locked door, never an open one.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: password === undefined ? passwordProblem() : 'unauthorised' },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  if (pathname !== '/') url.searchParams.set('next', safeNextPath(`${pathname}${search}`));
  return NextResponse.redirect(url);
}
