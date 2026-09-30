import { NextResponse } from 'next/server';
import { getWindowsAppNames, windowsDeviceBySlug } from '@/lib/queries';
import { deviceBySlug, getAndroidAppNames } from '@/lib/android-queries';
import { saveColorOverride, type ColorError } from '@/lib/app-color-overrides';
import { WINDOWS_RENAMES } from '@/lib/app-renames';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Set an app's chart colour, or clear it.
 *
 *   POST { platform: 'windows' | 'android', device: <slug>, key, color }
 *
 * `key` is what `/api/apps/name` takes: the family groupKey on Windows, the
 * uid on a phone. `color` is `#rgb` or `#rrggbb`; an empty string clears the
 * override and the app goes back to its brand or palette colour.
 *
 * Gated like every other `/api/*` write by the middleware: a signed-in
 * session, and a request from this origin.
 */

const MESSAGES: Record<ColorError, string> = {
  'unknown-app': 'No such app on this device.',
  'bad-color': 'A colour is a hex code like #2f80ed.',
};

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
  }
  const { platform, device, key, color } = body;
  if (typeof device !== 'string' || typeof key !== 'string' || typeof color !== 'string') {
    return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
  }

  let deviceKey: string;
  let known: Set<string>;
  if (platform === 'windows') {
    if (!windowsDeviceBySlug(device)) return notFound();
    deviceKey = WINDOWS_RENAMES;
    known = new Set(getWindowsAppNames().keys());
  } else if (platform === 'android') {
    const phone = deviceBySlug(device);
    if (!phone) return notFound();
    deviceKey = phone.deviceId;
    known = new Set(getAndroidAppNames(phone.deviceId).keys());
  } else {
    return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
  }

  const result = saveColorOverride({ device: deviceKey, key, color, known });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, message: MESSAGES[result.error] },
      { status: result.error === 'unknown-app' ? 404 : 422 },
    );
  }
  return NextResponse.json({ ok: true, color: result.color });
}

function notFound() {
  return NextResponse.json(
    { ok: false, error: 'unknown-device', message: 'No such device.' },
    { status: 404 },
  );
}
