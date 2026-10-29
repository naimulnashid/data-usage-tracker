/**
 * A brake on password guessing at `/api/login`.
 *
 * The route used to sleep 400ms after a wrong password and nothing else. That
 * bounds how long ONE guess takes, not how many can be in flight: parallel
 * requests each waited their 400ms side by side, so an attacker on the LAN
 * could guess as fast as they could open connections.
 *
 * **The budget is global, not per client, and that is deliberate.** The only
 * client identity a route handler can see is `X-Forwarded-For`, and `next
 * start` sets it with `??=` -- it keeps whatever the client sent. A per-address
 * limit would be bypassed by sending a different made-up address per request.
 * A single shared budget cannot be sidestepped that way.
 *
 * The cost is that someone on the network can keep the login form locked by
 * burning the budget. That is the right trade for a single-user dashboard:
 * existing sessions are unaffected (this only gates the login route), and
 * restarting the dashboard clears it.
 *
 * While locked, attempts are refused WITHOUT checking the password. Checking
 * and accepting a correct one would let guessing continue straight through the
 * lock.
 *
 * **An attempt is charged when it is ADMITTED, not when it fails.** The route
 * awaits the body and the comparison after admitting, so counting failures as
 * they completed let a burst of requests all pass the check before the first
 * was charged: a thousand in flight at once were a thousand guesses. `admit`
 * charges synchronously, so the eleventh concurrent request in a window is
 * refused, and the right password refunds the budget through `recordSuccess`.
 *
 * Pure and clock-injected so the self-test can drive it without timers.
 */

export interface ThrottleOptions {
  /** Failures are counted over this sliding window. */
  windowMs: number;
  /** This many failures inside the window trip a lock. */
  maxFailures: number;
  /** First lock length; each further lock doubles it... */
  baseLockMs: number;
  /** ...up to this. */
  maxLockMs: number;
  /** A quiet spell this long forgets earlier locks, so escalation resets. */
  forgetAfterMs: number;
}

export const DEFAULT_THROTTLE: ThrottleOptions = {
  windowMs: 60_000,
  maxFailures: 10,
  baseLockMs: 60_000,
  maxLockMs: 15 * 60_000,
  forgetAfterMs: 60 * 60_000,
};

export type ThrottleVerdict = { allowed: true } | { allowed: false; retryAfterMs: number };

export class LoginThrottle {
  private failures: number[] = [];
  private lockedUntil = 0;
  private strikes = 0;
  private lastLockAt = 0;

  constructor(private readonly opts: ThrottleOptions = DEFAULT_THROTTLE) {}

  check(now: number): ThrottleVerdict {
    if (now < this.lockedUntil) return { allowed: false, retryAfterMs: this.lockedUntil - now };
    return { allowed: true };
  }

  /**
   * The route's one call per attempt: refuse while locked, else charge the
   * attempt as a failure before any await. The attempt that spends the budget
   * is still allowed -- it is within it -- and locks out the ones after it.
   */
  admit(now: number): ThrottleVerdict {
    const verdict = this.check(now);
    if (verdict.allowed) this.recordFailure(now);
    return verdict;
  }

  recordFailure(now: number): void {
    if (this.strikes > 0 && now - this.lastLockAt > this.opts.forgetAfterMs) this.strikes = 0;

    this.failures = this.failures.filter((t) => now - t < this.opts.windowMs);
    this.failures.push(now);
    if (this.failures.length < this.opts.maxFailures) return;

    const lockMs = Math.min(this.opts.maxLockMs, this.opts.baseLockMs * 2 ** this.strikes);
    this.lockedUntil = now + lockMs;
    this.lastLockAt = now;
    this.strikes++;
    this.failures = [];
  }

  /** The right password ends the escalation: whoever holds it is not guessing. */
  recordSuccess(): void {
    this.failures = [];
    this.strikes = 0;
  }
}
