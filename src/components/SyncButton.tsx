'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toast } from './Toast';

type Phase = 'idle' | 'starting' | 'running' | 'done' | 'error';

interface LastRun {
  id: number;
  status: string;
  startedAt: string;
  rowsInserted: number;
  rowsSkipped: number;
  error: string | null;
}

interface PhonesLanded {
  lastId: number;
  uploads: number;
  rowsWritten: number;
}

/** How long a run may take before the button gives up, and how often it asks. */
const POLL_BUDGET_MS = 120_000;
const POLL_EVERY_MS = 2_000;

/** A delay that ends early, without throwing, when `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** "Added 12 new rows. 1 phone upload landed (43 new rows)." */
function outcome(added: number, phones: PhonesLanded | null): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`Added ${added.toLocaleString('en-US')} new rows.`);
  if (phones && phones.uploads > 0) {
    const n = phones.uploads;
    parts.push(
      `${n} phone upload${n === 1 ? '' : 's'} landed (${phones.rowsWritten.toLocaleString('en-US')} new rows).`,
    );
  }
  return parts.length ? parts.join(' ') : 'Up to date - nothing new since the last run.';
}

/**
 * Runs a collection on demand.
 *
 * The server cannot collect directly -- snapshotting SRUM needs Administrator
 * and the dashboard runs unelevated on purpose. It starts the registered
 * collector task instead, which delegates that one step to its own elevated
 * task. See `src/app/api/sync/route.ts`.
 *
 * The same run empties the phones' cloud inbox when one is configured, which
 * is why the phone pages carry this button too: it lands an upload now rather
 * than at the next scheduled drain.
 *
 * A run takes roughly 10-20s, so this starts the task and then polls, rather
 * than holding a request open. The outcome goes to a toast rather than inline
 * text: "nothing new" is the normal result and deserves saying, but its length
 * varies enough that putting it in the top bar rearranged the scope controls
 * every time a run finished.
 */
export function SyncButton() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const poll = useRef<AbortController | null>(null);
  const baseline = useRef<number | null>(null);
  const phonesBaseline = useRef(0);

  const stopPolling = useCallback(() => {
    poll.current?.abort();
    poll.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const finish = useCallback(
    (last: LastRun | null, phones: PhonesLanded | null) => {
      stopPolling();

      if (last && last.status === 'failed') {
        setPhase('error');
        setMessage(last.error ? `Collector failed: ${last.error}` : 'Collector failed.');
        return;
      }

      setPhase('done');
      setMessage(outcome(last?.rowsInserted ?? 0, phones));
      // Pull the server components again so the pages show the new rows.
      router.refresh();
    },
    [router, stopPolling],
  );

  const start = useCallback(async () => {
    setPhase('starting');
    setMessage(null);

    try {
      const seen = await fetch('/api/sync', { cache: 'no-store' }).then((r) => r.json());
      baseline.current = seen?.lastRun?.id ?? null;
      phonesBaseline.current = seen?.phones?.lastId ?? 0;

      const res = await fetch('/api/sync', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        setPhase('error');
        setMessage(body.detail ?? 'Could not start the collector.');
        return;
      }

      setPhase('running');

      // Poll for a NEW sync_log row rather than for the task going idle. The
      // task can report idle in the gap before the row lands, and the row is
      // what the user actually cares about.
      //
      // One request at a time, each with its own deadline, against a clock
      // that runs whether or not they succeed. It used to be a setInterval
      // whose 2-minute cut-off sat behind a successful fetch: with the server
      // down, every poll failed, the cut-off never ran, and the button said
      // "Collecting" forever while requests piled up behind each other.
      stopPolling();
      const control = new AbortController();
      poll.current = control;
      const deadline = Date.now() + POLL_BUDGET_MS;
      while (!control.signal.aborted) {
        await sleep(POLL_EVERY_MS, control.signal);
        if (control.signal.aborted) return;
        if (Date.now() > deadline) {
          // The collector normally finishes well inside this. Giving up here
          // means something is wrong, and saying so beats spinning forever.
          stopPolling();
          setPhase('error');
          setMessage('Timed out after 2 minutes. Check logs\\collector-*.log.');
          return;
        }
        // Its own controller, so a hung request is cut off without ending
        // the loop; unmounting aborts both.
        const request = new AbortController();
        const cut = () => request.abort();
        const timer = setTimeout(cut, POLL_EVERY_MS * 5);
        control.signal.addEventListener('abort', cut, { once: true });
        try {
          const s = (await fetch(`/api/sync?phonesSince=${phonesBaseline.current}`, {
            cache: 'no-store',
            signal: request.signal,
          }).then((r) => r.json())) as {
            running: boolean;
            lastRun: LastRun | null;
            phones?: PhonesLanded;
          };

          const isNew = s.lastRun && s.lastRun.id !== baseline.current;
          if (isNew && !s.running) return finish(s.lastRun, s.phones ?? null);
        } catch {
          /* transient, or aborted - the loop's own checks decide */
        } finally {
          clearTimeout(timer);
          control.signal.removeEventListener('abort', cut);
        }
      }
    } catch {
      setPhase('error');
      setMessage('Could not reach the server.');
    }
  }, [finish, stopPolling]);

  const busy = phase === 'starting' || phase === 'running';

  // What screen readers hear. The regions below exist from the first render,
  // because a live region created together with its text -- which the toast
  // is -- is often not announced at all. Errors go to the assertive one.
  const polite = phase === 'running' ? 'Collecting usage data' : phase === 'done' ? message ?? '' : '';
  const assertive = phase === 'error' ? message ?? '' : '';

  return (
    <>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{polite}</span>
      <span className="sr-only" aria-live="assertive" aria-atomic="true">{assertive}</span>

      <button
        type="button"
        className="chip sync-button"
        onClick={() => void start()}
        disabled={busy}
        data-busy={busy}
        title="Run the collector now, via its scheduled task"
      >
        <svg
          className={busy ? 'sync-icon spin' : 'sync-icon'}
          width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        {phase === 'starting' ? 'Starting' : phase === 'running' ? 'Collecting' : 'Sync now'}
      </button>

      {message && (
        <Toast
          message={message}
          kind={phase === 'error' ? 'error' : 'ok'}
          onDismiss={() => setMessage(null)}
        />
      )}
    </>
  );
}
