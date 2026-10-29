import { NextResponse } from 'next/server';
import { getWindowsAppKeys, windowsDeviceBySlug } from '@/lib/queries';
import { deviceBySlug, getAndroidAppKeys } from '@/lib/android-queries';
import { setHidden, setMerge, type PrefError } from '@/lib/app-prefs';
import { WINDOWS_RENAMES } from '@/lib/app-renames';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Hide an app from the By App page, or merge it into another.
 *
 *   POST { platform: 'windows' | 'android', device: <slug>, key,
 *          action: 'hide' | 'show' | 'merge' | 'unmerge', into? }
 *
 * `key` and `into` are what the detail URLs carry: the family groupKey on
 * Windows, the uid on a phone. Covered by the middleware's session and
 * same-origin checks, like every other `/api/*` write. See lib/app-prefs.ts.
 */

const MESSAGES: Record<PrefError, string> = {
  'unknown-app': 'No such app on this device.',
  'same-app': 'An app cannot be merged into itself.',
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad();
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad();
  const { platform, device, key, action, into } = body as Record<string, unknown>;
  if (typeof device !== 'string' || typeof key !== 'string' || typeof action !== 'string') return bad();

  let deviceKey: string;
  let known: Set<string>;
  if (platform === 'windows') {
    if (!windowsDeviceBySlug(device)) return notFound();
    deviceKey = WINDOWS_RENAMES;
    known = getWindowsAppKeys();
  } else if (platform === 'android') {
    const phone = deviceBySlug(device);
    if (!phone) return notFound();
    deviceKey = phone.deviceId;
    known = getAndroidAppKeys(phone.deviceId);
  } else {
    return bad();
  }
  if (!known.has(key)) return refuse('unknown-app');

  if (action === 'hide' || action === 'show') {
    setHidden(deviceKey, key, action === 'hide');
    return NextResponse.json({ ok: true });
  }
  if (action === 'merge' || action === 'unmerge') {
    if (action === 'merge' && typeof into !== 'string') return bad();
    const result = setMerge(deviceKey, key, action === 'merge' ? (into as string) : null, known);
    return result.ok ? NextResponse.json({ ok: true }) : refuse(result.error);
  }
  return bad();
}

function refuse(error: PrefError) {
  return NextResponse.json(
    { ok: false, error, message: MESSAGES[error] },
    { status: error === 'unknown-app' ? 404 : 422 },
  );
}

function bad() {
  return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
}

function notFound() {
  return NextResponse.json(
    { ok: false, error: 'unknown-device', message: 'No such device.' },
    { status: 404 },
  );
}
