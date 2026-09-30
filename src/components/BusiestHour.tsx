import { formatBytes } from '@/lib/format';

const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

/**
 * The Hour of day card's right-hand callout: the busiest hour and what it
 * moved, in the same slot and shape as the Trend card's "Heaviest day".
 *
 * `span` is how many hours one bar covers -- 1 on the laptop, 2 on a phone,
 * whose buckets are two hours wide -- so a phone's figure names the block
 * ("14:00-16:00") rather than pretending to one hour of precision.
 *
 * Renders nothing when every hour is zero: "Busiest hour 00:00, 0 B" would be
 * the first bucket winning a tie, not a finding.
 */
export function BusiestHour({
  data, span = 1,
}: {
  data: { hour: number; total: number }[];
  span?: number;
}) {
  const busiest = data.reduce<{ hour: number; total: number } | null>(
    (best, h) => (h.total > (best?.total ?? 0) ? h : best),
    null,
  );
  if (!busiest) return null;
  return (
    <div className="callout">
      <div className="callout-head">
        <span className="callout-label">Busiest hour</span>
        <span className="callout-date">
          {span > 1 ? `${hh(busiest.hour)}-${hh(busiest.hour + span)}` : hh(busiest.hour)}
        </span>
      </div>
      <div className="callout-value">{formatBytes(busiest.total)}</div>
    </div>
  );
}
