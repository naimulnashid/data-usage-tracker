/**
 * Password gate.
 *
 * The dashboard serves a detailed record of which programs run on this
 * machine, when, and how much they transferred. It listens on 127.0.0.1
 * unless `DASHBOARD_HOST` opens it to the LAN (scripts/run-next.mjs), which the
 * Android reporter needs -- and on a LAN, that record is worth a lock.
 *
 * Deliberately Web Crypto only, no `node:crypto` import: this module is pulled
 * into `middleware.ts`, which Next runs on the Edge runtime where the Node
 * built-ins do not exist. Adding a `node:` import here breaks the build.
 *
 * The session cookie is `<expiry-ms>.<HMAC-SHA256(expiry-ms)>`, keyed by a key
 * DERIVED from the password. Keying off the password is the point: changing it
 * in `.env.local` invalidates every outstanding session for free, with no
 * session store to keep.
 *
 * Derived, not the password itself, since 2026-09-21. The site is plain HTTP on
 * the LAN, so a cookie can be sniffed, and an HMAC keyed directly by the
 * password turned one sniffed cookie into an offline oracle: try a guess, see
 * if the signature matches, at millions of guesses per second on a GPU.
 * PBKDF2 makes every guess cost the full derivation instead. The server pays it
 * once per process (the key is cached), not per request.
 */

export const SESSION_COOKIE = 'datausage_session';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days - a phone should not re-auth daily.

/**
 * Shortest password the dashboard will accept.
 *
 * The login throttle caps online guessing, but it cannot make a short password
 * long. Twelve characters is well past what a capped guess rate reaches. It
 * fails closed like an unset password: a server with a short one refuses every
 * request and says why, rather than running with a door that is easy to open.
 */
export const MIN_PASSWORD_LENGTH = 12;

export type PasswordStatus = 'ok' | 'unset' | 'too-short';

export function passwordStatus(): PasswordStatus {
  const pw = process.env['DASHBOARD_PASSWORD'];
  if (!pw || pw.trim().length === 0) return 'unset';
  return pw.length < MIN_PASSWORD_LENGTH ? 'too-short' : 'ok';
}

/** The configured password, or undefined when it is unset or too short. */
export function configuredPassword(): string | undefined {
  return passwordStatus() === 'ok' ? process.env['DASHBOARD_PASSWORD'] : undefined;
}

/** The error code a caller reports when `configuredPassword()` is undefined. */
export function passwordProblem(): 'auth-not-configured' | 'auth-password-too-short' {
  return passwordStatus() === 'too-short' ? 'auth-password-too-short' : 'auth-not-configured';
}

/**
 * Length-independent equality.
 *
 * Compares SHA-256 digests rather than the strings, so neither the contents nor
 * the length leak through timing.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * PBKDF2 parameters for the signing key. The iteration count is OWASP's 2023
 * figure for PBKDF2-HMAC-SHA256. The salt is fixed rather than random because
 * there is nowhere to store one, and it does not need to be secret: its job is
 * only to make this derivation differ from any other use of the same password.
 * Bumping the `v1` invalidates every session, like a password change does.
 */
const KDF_ITERATIONS = 600_000;
const KDF_SALT = 'data-usage-tracker/session-signing/v1';

/**
 * One derivation per password per process. Cached as a promise so concurrent
 * first requests share the work instead of each paying for it. A rotated
 * password is simply a new entry; the old key is never consulted again.
 */
const signingKeys = new Map<string, Promise<CryptoKey>>();

function signingKey(secret: string): Promise<CryptoKey> {
  let key = signingKeys.get(secret);
  if (!key) {
    key = deriveSigningKey(secret);
    signingKeys.set(secret, key);
    // A failed derivation must not be cached forever.
    key.catch(() => signingKeys.delete(secret));
  }
  return key;
}

async function deriveSigningKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(KDF_SALT), iterations: KDF_ITERATIONS },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
}

async function sign(secret: string, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    'HMAC', await signingKey(secret), new TextEncoder().encode(payload),
  );
  return base64url(new Uint8Array(sig));
}

export async function issueSession(
  secret: string,
): Promise<{ value: string; maxAgeSeconds: number }> {
  const expiry = String(Date.now() + SESSION_TTL_MS);
  return {
    value: `${expiry}.${await sign(secret, expiry)}`,
    maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/**
 * How much of the session's life must elapse before it is worth reissuing.
 *
 * Without renewal a session dies 30 days after login even if you used it every
 * day, which reads as "it forgot me for no reason". Renewing on every request
 * would instead set a cookie on every page load, so this only refreshes once
 * the session is a day old.
 */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

/** True when a valid session is old enough to be worth extending. */
export function shouldRenew(cookie: string | undefined): boolean {
  if (!cookie) return false;
  const dot = cookie.lastIndexOf('.');
  if (dot <= 0) return false;
  const expiry = Number(cookie.slice(0, dot));
  if (!Number.isFinite(expiry)) return false;
  const issuedAt = expiry - SESSION_TTL_MS;
  return Date.now() - issuedAt > RENEW_AFTER_MS;
}

export async function verifySession(
  secret: string,
  cookie: string | undefined,
): Promise<boolean> {
  if (!cookie) return false;

  const dot = cookie.lastIndexOf('.');
  if (dot <= 0) return false;

  const payload = cookie.slice(0, dot);
  if (!(await safeEqual(cookie.slice(dot + 1), await sign(secret, payload)))) return false;

  const expiry = Number(payload);
  return Number.isFinite(expiry) && Date.now() < expiry;
}
