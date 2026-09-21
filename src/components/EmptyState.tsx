import Link from 'next/link';
import { ALL_DAYS } from '@/lib/scope';

/**
 * Shown when the database is missing or genuinely empty.
 *
 * Kept strictly separate from NoDataInScope below. Telling someone to go set
 * up the collector when the collector is working fine -- and the only problem
 * is that they picked a network with no traffic this week -- sends them chasing
 * a fault that does not exist.
 *
 * The command is the registration, not the collector: on a machine with no
 * data, the tasks are the likelier thing missing, and registering runs a first
 * collection anyway. It is the one step that needs Administrator.
 */
export function EmptyState() {
  return (
    <div className="empty">
      <h1 style={{ marginBottom: '0.8rem' }}>No data yet</h1>
      <p style={{ maxWidth: 520, margin: '0 auto 1.6rem' }}>
        The database has not been created, or holds no rows. Register the
        collector and run a first collection, once, from an{' '}
        <strong>Administrator</strong> PowerShell:
      </p>
      <pre
        className="mono"
        style={{
          display: 'inline-block', textAlign: 'left', padding: '1rem 1.3rem',
          background: 'var(--bg-panel)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-small)', color: 'var(--text-dim)',
        }}
      >
        powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1 -RunNow
      </pre>
    </div>
  );
}

/**
 * Shown when the database has data, but not for the selected scope.
 *
 * `home` is the device's own overview. It used to be a hardcoded `/?days=365`,
 * which was right only while the laptop owned the site root; now that every
 * device sits under its own slug, a fixed path would have bounced the reader
 * onto a different machine than the one whose empty range they were looking at.
 */
export function NoDataInScope({ scoped, home }: { scoped: boolean; home: string }) {
  return (
    <div className="empty">
      <h1 style={{ marginBottom: '0.8rem' }}>Nothing in this range</h1>
      <p style={{ maxWidth: 560, margin: '0 auto 1.6rem' }}>
        There is usage history stored, but none matching the current selection
        {scoped ? ' on this network' : ''}. Try a longer range
        {scoped ? ', or switch to All networks' : ''}.
      </p>
      {/* ALL_DAYS, not the 365 this used to carry: the button promises
          everything, and a year is not that. `home` is the bare device path,
          so the network filter is dropped too. */}
      <Link href={`${home}?days=${ALL_DAYS}`} className="chip" style={{ display: 'inline-block' }}>
        Show everything
      </Link>
    </div>
  );
}
