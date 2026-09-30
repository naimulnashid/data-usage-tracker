/**
 * Which page numbers a pager shows: the first and the last, the current page
 * with two either side, and a gap marker wherever pages are skipped.
 *
 *   pageItems(6, 12)  ->  1 … 4 5 6 7 8 … 12
 *   pageItems(2, 12)  ->  1 2 3 4 … 12
 *   pageItems(3, 5)   ->  1 2 3 4 5
 *
 * A gap is never shown in place of a single page: `1 … 3` would hide page 2
 * behind a marker as wide as the number itself, so it is drawn as `1 2 3`.
 * Everything else is one click away through the jump box beside it.
 */
export type PageItem = number | 'gap';

export function pageItems(page: number, count: number, around = 2): PageItem[] {
  if (count <= 1) return [1];
  const current = Math.min(Math.max(1, page), count);
  const shown = new Set<number>([1, count]);
  for (let p = current - around; p <= current + around; p++) if (p >= 1 && p <= count) shown.add(p);
  const sorted = [...shown].sort((a, b) => a - b);
  const out: PageItem[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    const prev = sorted[i - 1];
    if (prev !== undefined) {
      if (p - prev === 2) out.push(prev + 1);
      else if (p - prev > 2) out.push('gap');
    }
    out.push(p);
  }
  return out;
}

/** A requested page number from the URL, clamped to 1..count; anything unusable is 1. */
export function clampPage(raw: unknown, count: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), Math.max(1, count));
}
