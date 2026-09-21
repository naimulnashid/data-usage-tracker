/**
 * Minimal RFC 4180 CSV reader.
 *
 * Hand-rolled rather than pulled from npm: the collector is the piece that has
 * to still work years from now after a Windows reset and a clean install, so
 * every dependency it carries is a liability. This handles quoted fields,
 * escaped quotes, embedded commas and newlines, and a UTF-8 BOM -- which
 * SrumECmd does emit, and which otherwise corrupts the first column name.
 */

export function parseCsv(text: string): string[][] {
  // Strip BOM. SrumECmd writes one, so without this the first header reads
  // "﻿Id" and every lookup of "Id" misses.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (c === '\r') {
      // handled by the \n branch
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
    } else {
      field += c;
      fieldStarted = true;
    }
  }

  // Trailing field/row when the file does not end with a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Parse into objects keyed by header name.
 *
 * Column lookup is by EXACT name. Phase 1 shipped a regex-based probe that
 * matched /Sid/ and got `SidType` -- an enum -- because it sorts before `Sid`
 * and `UserId` in SrumECmd's column order. That silently made the dedup test
 * far coarser than intended. Never match these loosely.
 */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0]!.map((h) => h.trim());
  const out: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    // Skip blank trailing lines rather than emitting a row of empty strings.
    if (r.length === 1 && r[0] === '') continue;

    const obj: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) obj[header[j]!] = r[j] ?? '';
    out.push(obj);
  }

  return out;
}

/** Assert every expected column exists, naming all missing ones at once. */
export function requireColumns(
  rows: Record<string, string>[],
  required: readonly string[],
): void {
  if (rows.length === 0) return;
  const present = new Set(Object.keys(rows[0]!));
  const missing = required.filter((c) => !present.has(c));
  if (missing.length > 0) {
    throw new Error(
      `CSV is missing expected column(s): ${missing.join(', ')}\n` +
        `Columns present: ${[...present].join(', ')}\n` +
        `SrumECmd may have renamed them; update src/lib/srum.ts and docs/DESIGN.md.`,
    );
  }
}
