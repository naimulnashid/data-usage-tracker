import Link from 'next/link';
import { pageItems } from '@/lib/pager';

/**
 * Pages of a history table: Newest and Oldest at the ends, Newer and Older one
 * step each, the page numbers around the current one (lib/pager.ts), and a box
 * that jumps straight to any page. Page 1 is the newest.
 *
 * Links and a plain GET form, not client state: a page is a URL, so it can be
 * bookmarked and works before any script has loaded. The form carries only
 * `param`; the pages that use this have no other query of their own.
 */
export function Pager({
  page, count, path, param,
}: {
  page: number;
  count: number;
  /** The page's path, e.g. `/windows/my-pc/sync`. */
  path: string;
  /** The query parameter that holds the page number. */
  param: string;
}) {
  if (count <= 1) return null;
  const href = (p: number) => (p <= 1 ? path : `${path}?${param}=${p}`);

  const step = (to: number, label: string, disabled: boolean, title: string) => (
    <Link
      href={href(to)}
      className="chip"
      aria-disabled={disabled}
      data-disabled={disabled}
      // CSS stops the mouse (pointer-events: none); this stops Tab and Enter.
      tabIndex={disabled ? -1 : undefined}
      title={title}
    >
      {label}
    </Link>
  );

  return (
    <nav className="pager" aria-label="Pages">
      {step(1, 'Newest', page === 1, 'First page: the newest runs')}
      {step(page - 1, '← Newer', page === 1, 'Previous page')}
      <span className="pager-pages">
        {pageItems(page, count).map((item, i) =>
          item === 'gap' ? (
            <span key={`gap-${i}`} className="pager-gap" aria-hidden>&hellip;</span>
          ) : (
            <Link
              key={item}
              href={href(item)}
              className="chip pager-number"
              data-active={item === page}
              aria-current={item === page ? 'page' : undefined}
              aria-label={`Page ${item}`}
            >
              {item}
            </Link>
          ),
        )}
      </span>
      {step(page + 1, 'Older →', page === count, 'Next page')}
      {step(count, 'Oldest', page === count, 'Last page: the oldest runs')}
      <form action={path} method="get" className="pager-jump">
        <label htmlFor={`${param}-jump`}>Go to page</label>
        <input
          id={`${param}-jump`}
          name={param}
          type="number"
          min={1}
          max={count}
          defaultValue={page}
          className="pager-input"
          aria-label={`Page number, 1 to ${count}`}
        />
        <span className="pager-of">of {count}</span>
        <button type="submit" className="chip chip--small">Go</button>
      </form>
    </nav>
  );
}
