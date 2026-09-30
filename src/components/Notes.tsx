import { RETENTION_DAYS } from '@/lib/android-queries';

/*
  Fixed explanatory copy that a page and its loading skeleton both render.

  Shared rather than written twice because the skeleton lays these out for
  their HEIGHT (components/Skeleton.tsx, `SkMask`): a second copy would drift
  from the first, and the skeleton would quietly stop matching the page.
*/

/** Under the laptop's network list on the overview. */
export function WindowsNetworkNote() {
  return (
    <p className="ssid-note ssid-note--block">
      {/*
        Windows' own page is scoped to one network profile, so an all-networks
        total legitimately reads higher. Say so here, where the per-network
        rows make it checkable, or the gap reads as a bug.
      */}
      Windows&rsquo; own Data usage page shows one network at a time, so its figure
      matches one row here rather than the total. Names are learned by watching which
      network the laptop is on; an unnamed one fills in the next time it is seen.
    </p>
  );
}

/** The phone's Sync Status page: why a late phone is not an emergency. */
export function AndroidSyncNotes() {
  return (
    <ul className="prose-list">
      <li>
        <strong>Android keeps its own history for about {RETENTION_DAYS} days.</strong> The
        phone only has to be seen before that window closes, not promptly. The same
        rule as the Windows collector: collect faster than eviction, not faster than
        writing.
      </li>
      <li>
        <strong>Nothing on this machine can trigger a sync.</strong> The phone pushes;
        there is no equivalent of the Sync button, because there is no scheduled task
        here to start.
      </li>
      <li>
        <strong>Unmetered networks only.</strong> If the phone has been on mobile data
        for days, it will not have uploaded &mdash; by design. Backfilling over the
        connection this app exists to measure would be a self-inflicted wound.
      </li>
      <li>
        <strong>Usage access can be revoked silently.</strong> If Android reboots into a
        state where it is off, uploads keep succeeding but carry only the reporter&rsquo;s
        own traffic. The app&rsquo;s own screen is the place that says so.
      </li>
    </ul>
  );
}
