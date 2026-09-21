import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/**
 * Response headers for every route.
 *
 * The CSP cannot drop 'unsafe-inline' from script-src: Next streams its RSC
 * payload through inline scripts, and a nonce would have to be minted per
 * request, which the prerendered login page cannot carry. What it CAN do is
 * shut every door this dashboard never uses -- no framing, no plugins, no form
 * posts or fetches to anywhere but itself, no remote images or fonts. That last
 * part also makes the footer's "no outbound requests" something the browser
 * enforces rather than something the code promises.
 *
 * `next dev` needs eval for React Refresh, so development alone relaxes that.
 */
function securityHeaders(dev) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  return [
    { key: 'Content-Security-Policy', value: csp },
    // frame-ancestors covers modern browsers; this covers the rest. Together
    // they stop the Sync button being clickjacked from another page.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // Links out carry no trace of which app page they were followed from.
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), usb=(), payment=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
}

/** @param {string} phase */
export default function config(phase) {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;

  /** @type {import('next').NextConfig} */
  const nextConfig = {
    // Local-only tool: no telemetry, no image optimisation server, no remote anything.
    reactStrictMode: true,
    // Actually switches the optimiser off, which the line above used to only
    // claim. Nothing here uses next/image, yet /_next/image was live, outside the
    // auth middleware's matcher, and handing requests to sharp -- the surface of
    // GHSA-2xp9-vwfh-vxw4. With this set, Next answers 404 before sharp is loaded.
    images: { unoptimized: true },
    // No `X-Powered-By: Next.js`. Naming the framework on every response only
    // helps someone matching it against an advisory list.
    poweredByHeader: false,
    // node:sqlite is a Node builtin and must not be bundled for the browser.
    // Every query runs in a server component or route handler.
    serverExternalPackages: [],
    async headers() {
      return [{ source: '/:path*', headers: securityHeaders(dev) }];
    },
  };
  return nextConfig;
}
