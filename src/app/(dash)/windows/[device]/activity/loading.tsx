import { SkActivityPage } from '@/components/Skeleton';
import { windowsDevice } from '@/lib/queries';

/** Expanded heat map skeleton; see `SkActivityPage`. */
export default function Loading() {
  return (
    <SkActivityPage
      device={windowsDevice().label}
      cardSub="Daily totals. Outlined days were never collected - before collection started, or lost before a run read them - which is not the same as a quiet day."
    />
  );
}
