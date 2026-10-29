/**
 * The cloud inbox's only door.
 *
 * Phones post sealed envelopes here; the laptop collects and deletes them.
 * It cannot read an envelope and does not try: it checks who is calling, how
 * big the body is and that it starts with the envelope's magic bytes, and
 * stores it. Everything else -- opening, validating, ingesting -- happens on
 * the laptop, in that project's src/lib/inbox.ts.
 *
 * ONE function serves both sibling projects, Data Usage Tracker and Screen
 * Time Tracker, because a free Supabase plan allows two projects. Each app is
 * a separate mailbox: its own path, its own tokens, its own rows. A token is
 * looked up for (app, role), and every query filters on app, so neither
 * project's drain token can read or delete the other's envelopes.
 *
 *   /inbox[/<app>]            upload token   GET: "is this the inbox?"; POST: store one envelope
 *   /inbox[/<app>]/pending    drain token    oldest first (?limit, ?after=<id>, ?failed=1)
 *   /inbox[/<app>]/ack        drain token    {done: [id], failed: [{id, error}]}
 *
 * No <app> segment means data-usage, the app the inbox was built for, so its
 * phones' addresses never change. The same file ships in both repos; keep the
 * copies identical.
 *
 * Deployed with verify_jwt OFF, because neither caller holds a Supabase JWT:
 * the bearer token checked below is the authentication. No imports, for the
 * same reason the Android apps have no dependencies -- it must still deploy
 * years from now.
 */

const DB = `${Deno.env.get('SUPABASE_URL')}/rest/v1`;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * Per app: the envelope magic, and the largest envelope accepted -- each the
 * same as that dashboard's own limit for a direct upload.
 */
const APPS: Record<string, { magic: string; maxBytes: number }> = {
  'data-usage': { magic: 'DUI1', maxBytes: 2 * 1024 * 1024 },
  'screen-time': { magic: 'STI1', maxBytes: 8 * 1024 * 1024 },
};
const DEFAULT_APP = 'data-usage';
/** magic + P-256 point + nonce + GCM tag: the smallest possible envelope. */
const MIN_ENVELOPE_BYTES = 4 + 65 + 12 + 16;
/** Envelopes per /pending response, so one reply stays far below memory limits. */
const MAX_PAGE = 10;
/** An ack names at most a page's worth of ids; these leave room and stop there. */
const MAX_ACK_IDS = 100;
const MAX_ACK_BYTES = 64 * 1024;

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
 * Whether the request carries the token for (`app`, `role`).
 *
 * Compared as SHA-256 digests, so the stored value is never a usable token
 * and the comparison's timing can leak nothing but a digest prefix.
 */
async function authorised(req: Request, app: string, role: 'upload' | 'drain'): Promise<boolean> {
  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (presented.length < 16) return false;

  const res = await db(`inbox_keys?app=eq.${app}&role=eq.${role}&select=token_sha256`);
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

/**
 * The body, or null once it passes `max` bytes -- counted as it streams, not
 * after. `arrayBuffer()` buffers the whole thing first, and a chunked body
 * declares no length to refuse up front.
 */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.length;
  }
  return body;
}

/** An envelope id: PostgREST would take anything, so only these reach a filter. */
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

async function store(req: Request, app: string): Promise<Response> {
  const { magic, maxBytes } = APPS[app];
  const body = await readCapped(req, maxBytes);
  if (!body) return json({ ok: false, error: 'body-too-large' }, 413);
  const wantMagic = [...magic].map((c) => c.charCodeAt(0));
  if (body.length < MIN_ENVELOPE_BYTES || wantMagic.some((b, i) => body[i] !== b)) {
    // Most likely an older app posting plain JSON at the inbox address.
    return json({ ok: false, error: 'not-an-envelope: update the app, or set up the inbox again' }, 400);
  }

  const hint = (req.headers.get('x-device-hint') ?? '').slice(0, 128) || null;
  const res = await db('inbox_envelopes', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ app, device_hint: hint, size_bytes: body.length, envelope: toBase64(body) }),
  });
  if (!res.ok) return json({ ok: false, error: `store-failed: ${res.status}` }, 500);
  const [row] = (await res.json()) as { id: number; received_at: string }[];
  return json({ ok: true, inbox: true, id: row.id, receivedAt: row.received_at });
}

async function pending(url: URL, app: string): Promise<Response> {
  const limit = Math.min(MAX_PAGE, Math.max(1, Number(url.searchParams.get('limit')) || MAX_PAGE));
  const failed = url.searchParams.get('failed') === '1';
  const after = Math.max(0, Math.floor(Number(url.searchParams.get('after')) || 0));
  const filter = `&app=eq.${app}` + (failed ? '' : '&failed_at=is.null');
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

async function ack(req: Request, app: string): Promise<Response> {
  const raw = await readCapped(req, MAX_ACK_BYTES);
  if (!raw) return json({ ok: false, error: 'body-too-large' }, 413);
  let body: { done?: unknown; failed?: unknown } | null = null;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    /* treated as an empty ack, as before */
  }
  const done = Array.isArray(body?.done) ? body.done.filter(isId) : [];
  const failed = Array.isArray(body?.failed)
    ? (body.failed as { id?: unknown; error?: unknown }[]).filter((f) => isId(f?.id))
    : [];
  // Checked before any write, so an oversized ack changes nothing at all.
  if (done.length + failed.length > MAX_ACK_IDS) return json({ ok: false, error: 'too-many-ids' }, 413);

  // app=eq.<app> on every write: an id belonging to the other app is a no-op.
  if (done.length > 0) {
    const res = await db(`inbox_envelopes?app=eq.${app}&id=in.(${done.join(',')})`, { method: 'DELETE' });
    if (!res.ok) return json({ ok: false, error: `delete-failed: ${res.status}` }, 500);
  }
  for (const f of failed) {
    const res = await db(`inbox_envelopes?app=eq.${app}&id=eq.${f.id}`, {
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

/** "/functions/v1/inbox/screen-time/pending" -> { app, action }, or null. */
function route(pathname: string): { app: string; action: string } | null {
  const parts = pathname.split('/').filter(Boolean);
  const at = parts.lastIndexOf('inbox');
  if (at < 0) return null;
  const rest = parts.slice(at + 1);
  let app = DEFAULT_APP;
  if (rest.length > 0 && rest[0] in APPS) app = rest.shift()!;
  if (rest.length > 1) return null;
  const action = rest[0] ?? '';
  if (!['', 'pending', 'ack'].includes(action)) return null;
  return { app, action };
}

Deno.serve(async (req) => {
  try {
    const r = route(new URL(req.url).pathname);
    if (!r) return json({ ok: false, error: 'not-found' }, 404);

    if (r.action === 'pending' || r.action === 'ack') {
      if (!(await authorised(req, r.app, 'drain'))) return json({ ok: false, error: 'bad-token' }, 401);
      if (r.action === 'pending' && req.method === 'GET') return await pending(new URL(req.url), r.app);
      if (r.action === 'ack' && req.method === 'POST') return await ack(req, r.app);
      return json({ ok: false, error: 'method-not-allowed' }, 405);
    }

    if (!(await authorised(req, r.app, 'upload'))) return json({ ok: false, error: 'bad-token' }, 401);
    if (req.method === 'GET') return json({ ok: true, inbox: true });
    if (req.method === 'POST') return await store(req, r.app);
    return json({ ok: false, error: 'method-not-allowed' }, 405);
  } catch (err) {
    // The detail goes to the function's logs, not the caller.
    console.error(err);
    return json({ ok: false, error: 'inbox-error' }, 500);
  }
});
