import { Card, CardTitle } from '@/components/Card';

/**
 * Shown until the phone has actually uploaded something.
 *
 * States what to do rather than saying "no data": the setup has three steps and
 * two of them are on the phone, so a bare empty state would leave the reader
 * with nothing to act on.
 */
export function AndroidEmpty() {
  return (
    <>
      <div className="page-head">
        <h1>Android</h1>
        <p>No uploads yet from the phone.</p>
      </div>

      <Card hover={false}>
        <CardTitle sub="The app lives in android/ and is installed with `adb install`.">
          Setting up the reporter
        </CardTitle>
        <ul className="prose-list">
          <li>Open <strong>Data Usage Reporter</strong> on the phone.</li>
          <li>
            Enter this machine&rsquo;s address and the <code>ANDROID_INGEST_TOKEN</code> from
            <code>.env.local</code>, then <strong>Save and test connection</strong>.
          </li>
          <li>
            <strong>Grant usage access.</strong> Without it Android returns only the
            reporter&rsquo;s own traffic, which looks exactly like the app working.
          </li>
          <li>Tap <strong>Sync now</strong>. The first backfill covers about 90 days.</li>
        </ul>
      </Card>
    </>
  );
}
