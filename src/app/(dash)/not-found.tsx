import Link from 'next/link';

/**
 * notFound() from any dashboard page lands here, inside the shell, so the
 * device list is still there to pick from.
 *
 * The usual cause is an old link: a device's address comes from its name, so
 * renaming a laptop in config/collector.json moves its pages, and an app only
 * has a detail page while it has enough activity to earn one.
 */
export default function DashNotFound() {
  return (
    <div className="empty">
      <h1 style={{ marginBottom: '0.8rem' }}>Not found</h1>
      <p style={{ maxWidth: 560, margin: '0 auto 1.6rem' }}>
        There is no device, app or page at this address. A device&rsquo;s
        address comes from its name, so a renamed device moves; and an app only
        has a page of its own while it has enough activity to show.
      </p>
      <Link href="/" className="chip" style={{ display: 'inline-block' }}>
        Go to the overview
      </Link>
    </div>
  );
}
