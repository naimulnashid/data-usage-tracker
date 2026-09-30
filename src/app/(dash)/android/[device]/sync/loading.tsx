import {
  SkPageHead, SkStats, SkStat, SkCard, SkText, SkMask, SkeletonGap, SkeletonTable,
} from '@/components/Skeleton';
import { AndroidSyncNotes } from '@/components/Notes';

/**
 * Android sync skeleton, shape-accurate since 2026-09-30
 * (components/Skeleton.tsx). "How this differs" is the page's own list
 * (components/Notes.tsx), so its height is exact at every width.
 *
 * **The upload table is a deliberate departure.** It grows with every upload
 * up to a 25-row cap, so no fixed height matches it for long. Seven rows of
 * the measured 56px covers the first viewport, the only part that can jump.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead
        title="Sync Status"
        sub="Android 16 (API 36) · Pixel 8 pushes on its own schedule — every 6 hours, on unmetered networks only. Nothing here triggers it."
      />
      <SkStats columns={3}>
        <SkStat size="small" label="Last upload" value="2h ago" sub="30 Sept 2026, 11:04" />
        <SkStat size="small" label="Collection runway" value="88 days" sub="before Android deletes anything not yet collected" />
        <SkStat size="small" label="Stored" value="21,466" sub="90 days · 48 uids" />
      </SkStats>
      <SkCard
        title="Upload history"
        sub={
          'An upload that stores 0 new rows is normal and healthy: the phone re-sends the '
          + 'most recent bucket every time, because it was still filling when it was last read. '
          + '"Updated" is that bucket being replaced with its finished value.'
        }
        aside={<span className="callout-sub" style={{ whiteSpace: 'nowrap' }}><SkText>1–25 of 42</SkText></span>}
      >
        <SkeletonTable rows={7} columns={5} rowHeight={56} />
      </SkCard>
      <SkeletonGap />
      <SkCard title="How this differs from the collector" sub="Why a late phone is not the same emergency it would be on the Windows side.">
        <SkMask><AndroidSyncNotes /></SkMask>
      </SkCard>
    </>
  );
}
