import {
  SkPageHead, SkStats, SkStat, SkCard, SkText, SkeletonTable,
} from '@/components/Skeleton';

/**
 * Sync Status skeleton, shape-accurate since 2026-09-30 (components/Skeleton.tsx):
 * the real head, score cards and Run history title, so their wrapping at any
 * width is the page's own.
 *
 * The run table is a deliberate departure. Pagination bounds it at 25 rows,
 * but it holds 1 to 25 depending on how many runs exist, and a pager and a
 * "recent errors" block follow it only sometimes. Ten rows of the measured
 * 56px covers the first screenful, which is the only part that can jump.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead
        title="Sync Status"
        sub="The reset-survival guarantee depends on the scheduled task actually running. This page is how a broken task gets noticed in time."
      />
      <SkStats columns={3}>
        <SkStat size="small" label="Last successful run" value="51 min ago" sub="30 Sept 2026, 13:01" />
        <SkStat size="small" label="Rows stored" value="18,315" sub="97 days · 2026-06-23 → 2026-09-30" />
        <SkStat size="small" label="Last backup" value="OK" sub="Restore from the backup, not the live file" />
      </SkStats>
      <SkCard
        title="Run history"
        sub="A run that inserts 0 rows is normal and healthy — it means nothing new had accumulated since the last one."
        aside={<span className="callout-sub" style={{ whiteSpace: 'nowrap' }}><SkText>1–25 of 131</SkText></span>}
      >
        <SkeletonTable rows={10} columns={7} rowHeight={56} />
      </SkCard>
    </>
  );
}
