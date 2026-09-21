import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { LOGO_ROOT } from '@/lib/app-icons';

/**
 * Serving `public/apps_logo/<device>/` through a route handler instead of
 * Next's static folder.
 *
 * This exists for one measured reason: **`next start` snapshots `public/` at
 * boot.** A file dropped in while the dashboard is running 404s until the
 * service is restarted — verified 2026-08-26 by adding `public/favicon.ico` to
 * a running server and getting a 404 for it. The dashboard runs as a logon task
 * that can stay up for weeks, so "add a logo, see the logo" would otherwise
 * have meant "add a logo, remember to restart the dashboard", which is exactly
 * the kind of invisible staleness `dashboard-service.ps1` already guards
 * against for code.
 *
 * The `<device>` segment is the folder name, which is that device's URL slug —
 * `my-pc` for the laptop, `pixel-8` for a phone. It is part of the
 * path rather than a query
 * parameter so the same file name under two devices is two distinct URLs, and
 * so a browser cache cannot serve one device's mark on another's page.
 *
 * Reading per request costs a `statSync` plus, on a cache miss, one small file
 * read. Everything here is local and single-user.
 */

export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ device: string; file: string }> },
) {
  const { device: rawDevice, file } = await params;
  const device = decodeURIComponent(rawDevice);
  const name = decodeURIComponent(file);

  // Allow-list by directory listing rather than sanitising the string, at both
  // levels. A segment that is not literally one of the entries present cannot
  // be reached, so path traversal has nothing to work with — `..` is neither a
  // directory in the listing nor a file name in one.
  const root = join(process.cwd(), ...LOGO_ROOT);
  let devices: string[];
  try {
    devices = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return new NextResponse('no logo directory', { status: 404 });
  }
  if (!devices.includes(device)) {
    return new NextResponse('unknown device', { status: 404 });
  }

  const dir = join(root, device);
  const present = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  if (!present.includes(name)) {
    return new NextResponse('not found', { status: 404 });
  }

  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  const type = CONTENT_TYPES[ext];
  if (!type) return new NextResponse('unsupported type', { status: 404 });

  const path = join(dir, name);
  const stat = statSync(path);
  const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;

  // Revalidate every time, but transfer only when the file actually changed.
  // Replacing a logo in place therefore takes effect on the next page load.
  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'no-cache' },
    });
  }

  const body = readFileSync(path);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      ETag: etag,
      'Cache-Control': 'no-cache',
      ...(ext === '.svg' ? { 'Content-Security-Policy': SVG_POLICY } : {}),
    },
  });
}

/**
 * An SVG is a document, not just a picture. Rendered through `<img>`, which is
 * how every page here uses these, its scripts never run. But the same URL
 * opened directly (a new tab, a pasted link) renders it as a page on THIS
 * origin, where a script inside would run with the dashboard's cookies. Logos
 * are dropped in by hand from wherever they were found, so that is a real
 * path. None of the committed files carry script (checked 2026-09-21); this
 * keeps it that way for files added later. `sandbox` alone would stop script;
 * `default-src 'none'` also stops the file loading anything from elsewhere.
 */
const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
