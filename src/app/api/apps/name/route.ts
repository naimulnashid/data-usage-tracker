import { NextResponse } from 'next/server';
import { getWindowsAppNames, windowsDeviceBySlug } from '@/lib/queries';
import { deviceBySlug, getAndroidAppNames } from '@/lib/android-queries';
import { saveRename, WINDOWS_RENAMES, MAX_NAME_LENGTH, type RenameError } from '@/lib/app-renames';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rename an app, or clear its rename.
 *
 *   POST { platform: 'windows' | 'android', device: <slug>, key, name }
 *
 * `key` is the family groupKey on Windows and the uid on a phone -- what the
 * detail URLs already carry. An empty `name` clears the rename, and so does
 * the app's original name.
 *
 * This is the dashboard's only write besides the phone's ingest. It needs no
 * gate of its own: the middleware requires a signed-in session for every
 * `/api/*` route, and refuses any state-changing request that did not come
 * from this origin -- see `fromOwnOrigin` in middleware.ts.
 */

const MESSAGES: Record<RenameError, string> = {
  'unknown-app': 'No such app on this device.',
  'bad-name': `A name needs 1 to ${MAX_NAME_LENGTH} characters.`,
  reserved: 'That name is reserved for grouped traffic.',
  taken: 'Another app on this device already has that name.',
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
  }
  // `null` is valid JSON, and destructuring it throws: a 500 for a bad request.
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
  }
  const { platform, device, key, name } = body as Record<string, unknown>;
  if (typeof device !== 'string' || typeof key !== 'string' || typeof name !== 'string') {
    return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
  }

  let deviceKey: string;
  let names: Map<string, { name: string; base: string }>;
  if (platform === 'windows') {
    if (!windowsDeviceBySlug(device)) return notFound();
    deviceKey = WINDOWS_RENAMES;
    names = getWindowsAppNames();
  } else if (platform === 'android') {
    const phone = deviceBySlug(device);
    if (!phone) return notFound();
    deviceKey = phone.deviceId;
    names = getAndroidAppNames(phone.deviceId);
  } else {
    return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
  }

  const app = names.get(key);
  const result = saveRename({
    device: deviceKey,
    key,
    name,
    current: names,
    base: app?.base ?? '',
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, message: MESSAGES[result.error] },
      { status: result.error === 'unknown-app' ? 404 : 422 },
    );
  }
  return NextResponse.json({ ok: true, name: result.name, renamed: result.name !== app?.base });
}

function notFound() {
  return NextResponse.json(
    { ok: false, error: 'unknown-device', message: 'No such device.' },
    { status: 404 },
  );
}
