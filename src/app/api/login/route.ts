import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  configuredPassword,
  issueSession,
  passwordProblem,
  safeEqual,
} from '@/lib/auth';
import { LoginThrottle } from '@/lib/login-throttle';

export const runtime = 'nodejs';

/**
 * Slows each wrong guess. On its own this bounded latency, not throughput --
 * parallel guesses each waited side by side -- which is what the throttle is
 * for. Kept because it still makes a single interactive attacker slower.
 */
const WRONG_PASSWORD_DELAY_MS = 400;

/** One budget for the whole server. See login-throttle.ts for why not per client. */
const throttle = new LoginThrottle();

export async function POST(request: Request) {
  const expected = configuredPassword();
  if (!expected) {
    return NextResponse.json({ error: passwordProblem() }, { status: 503 });
  }

  const verdict = throttle.check(Date.now());
  if (!verdict.allowed) {
    const seconds = Math.ceil(verdict.retryAfterMs / 1000);
    return NextResponse.json(
      { error: 'too-many-attempts', retryAfterSeconds: seconds },
      { status: 429, headers: { 'Retry-After': String(seconds) } },
    );
  }

  let submitted: unknown;
  try {
    submitted = ((await request.json()) as { password?: unknown })?.password;
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  if (typeof submitted !== 'string' || !(await safeEqual(submitted, expected))) {
    throttle.recordFailure(Date.now());
    await new Promise((r) => setTimeout(r, WRONG_PASSWORD_DELAY_MS));
    return NextResponse.json({ error: 'wrong-password' }, { status: 401 });
  }

  throttle.recordSuccess();
  const { value, maxAgeSeconds } = await issueSession(expected);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
    // NOT `secure`. This is served over plain HTTP on the LAN; a secure cookie
    // would simply never be stored, and the symptom is a login form that
    // appears to do nothing -- it accepts the password, returns 200, and
    // bounces straight back to /login.
    secure: false,
  });
  return response;
}

/** Sign out. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
