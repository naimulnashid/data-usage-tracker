/**
 * Did a state-changing request come from a page served by this dashboard?
 *
 * The session cookie is `SameSite=Lax`, which stops another SITE from riding
 * it -- but a site is scheme + host with the port ignored, so every
 * `localhost:*` page counts as same-site, the neighbouring dashboards on 7842
 * and 7844-7846 included. Any of them, or anything else served on localhost,
 * could POST to `/api/sync` with the cookie attached.
 *
 * `Sec-Fetch-Site` answers the question exactly and cannot be set by page
 * script. `same-origin` is our own pages; `none` is the user typing a URL or
 * a non-browser client. `Origin` is checked as well, and is the only signal
 * from browsers that predate `Sec-Fetch-Site`. A request carrying neither is
 * not from a browser, so it cannot be CSRF.
 *
 * `Origin` is compared with the `Host` header -- the address the browser
 * actually sent the request to -- and NOT with `request.nextUrl.origin`. Under
 * `next start -H <addr>`, which `scripts/run-next.mjs` always passes, Next
 * builds that URL from the BIND address: `http://127.0.0.1:7843` by default,
 * `http://0.0.0.0:7843` when opened to the LAN. No browser ever sends either
 * as its origin from `localhost:7843` or a LAN IP, so the first version of this
 * check refused every login, sync and sign-out a real browser made, and the
 * login page reported it as a wrong password. A page cannot choose the `Host`
 * its request carries, and it cannot forge `Origin`, so comparing the two is
 * the standard same-origin test.
 *
 * Pure and header-only so it runs on the Edge runtime and in the self-test.
 */
export function isSameOrigin(headers: {
  site: string | null;
  origin: string | null;
  host: string | null;
}): boolean {
  const { site, origin, host } = headers;
  if (site && site !== 'same-origin' && site !== 'none') return false;
  if (!origin) return true;
  // `Origin: null` (a sandboxed frame, a file:// page) is not a URL, and not us.
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return host !== null && originHost.toLowerCase() === host.toLowerCase();
}
