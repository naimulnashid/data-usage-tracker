import { SkActivityPage } from '@/components/Skeleton';

/** Expanded heat map skeleton; see `SkActivityPage`. */
export default function Loading() {
  return (
    <SkActivityPage
      device="Phone"
      cardSub="Daily totals. Outlined days are before this phone started reporting - no data was recorded, which is not the same as a quiet day."
    />
  );
}
