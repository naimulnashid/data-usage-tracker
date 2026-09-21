/**
 * Where a successful login may send the reader: a path on THIS origin, or `/`.
 *
 * Shared by the login page (which follows `?next=`) and the middleware (which
 * writes it), so the two cannot disagree about what is safe. No imports, so it
 * runs in the browser and on the Edge runtime alike.
 *
 * The rule used to be "starts with `/` and not `//`", which a backslash walks
 * straight past: `/login?next=/%5Cevil.example` arrives as `/\evil.example`,
 * and the URL parser treats `\` as `/`, so the browser resolved it to
 * `http://evil.example/`. Next's router then did a hard navigation there --
 * `handleExternalUrl` -> `location.assign` -- which made a genuine login
 * screen a springboard to a lookalike. Verified 2026-09-21 before the fix.
 *
 * So the check is now the one that cannot be argued with: resolve the value
 * against a placeholder origin and require the origin to be unchanged.
 * Backslashes and control characters are refused outright as well, because
 * the parser silently rewrites or strips them, and anything the parser
 * rewrites is not what the author of the link appeared to write.
 */

const PLACEHOLDER_ORIGIN = 'http://dashboard.invalid';

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return '/';

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return '/';
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
