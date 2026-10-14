/**
 * The cloud inbox's only door.
 *
 * Phones post sealed envelopes here; the laptop collects and deletes them.
 * It cannot read an envelope and does not try: it checks who is calling, how
 * big the body is and that it starts with the envelope's magic bytes, and
 * stores it. Everything else -- opening, validating, ingesting -- happens on
 * the laptop, in src/lib/inbox.ts.
 *
 *   GET  /inbox            upload token   "is this the inbox?" (Test connection)
 *   POST /inbox            upload token   store one envelope
 *   GET  /inbox/pending    drain token    oldest first (?limit, ?after=<id>, ?failed=1)
 *   POST /inbox/ack        drain token    {done: [id], failed: [{id, error}]}
 *
 * Deployed with verify_jwt OFF, because neither caller holds a Supabase JWT:
 * the bearer token checked below is the authentication. No imports, for the
 * same reason the Android app has no dependencies -- it must still deploy
 * years from now.
 */

const DB = `${Deno.env.get('SUPABASE_URL')}/rest/v1`;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/** Matches the dashboard's own MAX_WIRE_BYTES for a direct upload. */
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const MAGIC = [0x44, 0x55, 0x49, 0x31]; // "DUI1"
/** magic + P-256 point + nonce + GCM tag: the smallest possible envelope. */
const MIN_ENVELOPE_BYTES = 4 + 65 + 12 + 16;
/** Envelopes per /pending response, so one reply stays far below memory limits. */
const MAX_PAGE = 10;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function db(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${DB}/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether the request carries the token for `role`.
 *
 * Compared as SHA-256 digests, so the stored value is never a usable token
 * and the comparison's timing can leak nothing but a digest prefix.
 */
async function authorised(req: Request, role: 'upload' | 'drain'): Promise<boolean> {
  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (presented.length < 16) return false;

  const res = await db(`inbox_keys?role=eq.${role}&select=token_sha256`);
  if (!res.ok) throw new Error(`key lookup failed: ${res.status}`);
  const rows = (await res.json()) as { token_sha256: string }[];
  if (rows.length !== 1) return false;
  return (await sha256Hex(presented)) === rows[0].token_sha256;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function store(req: Request): Promise<Response> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ENVELOPE_BYTES) {
    return json({ ok: false, error: 'body-too-large' }, 413);
  }
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length > MAX_ENVELOPE_BYTES) return json({ ok: false, error: 'body-too-large' }, 413);
  if (body.length < MIN_ENVELOPE_BYTES || MAGIC.some((b, i) => body[i] !== b)) {
    // Most likely an older app posting plain JSON at the inbox address.
    return json({ ok: false, error: 'not-an-envelope: update the app, or set up the inbox again' }, 400);
  }

  const hint = (req.headers.get('x-device-hint') ?? '').slice(0, 128) || null;
  const res = await db('inbox_envelopes', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ device_hint: hint, size_bytes: body.length, envelope: toBase64(body) }),
  });
  if (!res.ok) return json({ ok: false, error: `store-failed: ${res.status}` }, 500);
  const [row] = (await res.json()) as { id: number; received_at: string }[];
  return json({ ok: true, inbox: true, id: row.id, receivedAt: row.received_at });
}

async function pending(url: URL): Promise<Response> {
  const limit = Math.min(MAX_PAGE, Math.max(1, Number(url.searchParams.get('limit')) || MAX_PAGE));
  const failed = url.searchParams.get('failed') === '1';
  const after = Math.max(0, Math.floor(Number(url.searchParams.get('after')) || 0));
  const filter = failed ? '' : '&failed_at=is.null';
  const res = await db(
    `inbox_envelopes?select=id,received_at,device_hint,envelope,failed_at,error` +
      `${filter}&id=gt.${after}&order=id.asc&limit=${limit}`,
  );
  if (!res.ok) return json({ ok: false, error: `read-failed: ${res.status}` }, 500);
  const rows = await res.json();

  const count = await db(`inbox_envelopes?select=id${filter}`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact' },
  });
  const total = Number((count.headers.get('content-range') ?? '').split('/')[1]);
  return json({ ok: true, envelopes: rows, remaining: Number.isFinite(total) ? total : null });
}

async function ack(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { done?: unknown; failed?: unknown }
    | null;
  const done = Array.isArray(body?.done) ? body.done.filter(Number.isInteger) as number[] : [];
  const failed = Array.isArray(body?.failed)
    ? (body.failed as { id?: unknown; error?: unknown }[]).filter((f) => Number.isInteger(f?.id))
    : [];

  if (done.length > 0) {
    const res = await db(`inbox_envelopes?id=in.(${done.join(',')})`, { method: 'DELETE' });
    if (!res.ok) return json({ ok: false, error: `delete-failed: ${res.status}` }, 500);
  }
  for (const f of failed) {
    const res = await db(`inbox_envelopes?id=eq.${f.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        failed_at: new Date().toISOString(),
        error: String(f.error ?? 'failed').slice(0, 500),
      }),
    });
    if (!res.ok) return json({ ok: false, error: `mark-failed: ${res.status}` }, 500);
  }
  return json({ ok: true, deleted: done.length, failed: failed.length });
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (path.endsWith('/inbox/pending') || path.endsWith('/inbox/ack')) {
      if (!(await authorised(req, 'drain'))) return json({ ok: false, error: 'bad-token' }, 401);
      if (path.endsWith('/pending') && req.method === 'GET') return await pending(url);
      if (path.endsWith('/ack') && req.method === 'POST') return await ack(req);
      return json({ ok: false, error: 'method-not-allowed' }, 405);
    }

    if (path.endsWith('/inbox')) {
      if (!(await authorised(req, 'upload'))) return json({ ok: false, error: 'bad-token' }, 401);
      if (req.method === 'GET') return json({ ok: true, inbox: true });
      if (req.method === 'POST') return await store(req);
      return json({ ok: false, error: 'method-not-allowed' }, 405);
    }

    return json({ ok: false, error: 'not-found' }, 404);
  } catch (err) {
    // The detail goes to the function's logs, not the caller.
    console.error(err);
    return json({ ok: false, error: 'inbox-error' }, 500);
  }
});
