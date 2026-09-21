/**
 * Print a one-line JSON summary of a usage database.
 *
 *   node scripts/db-info.mjs <path-to.db>
 *
 * A real file rather than an inline snippet piped through PowerShell: the
 * inline version had to be written to a temp file and invoked, which put the
 * script path at argv[1] and the database at argv[2] -- easy to get wrong, and
 * it fails as "file is not a database", which reads like a corrupt backup
 * rather than a bug in the caller. This is also independently runnable.
 *
 * Always exits 0 and always prints JSON; the caller decides what a failure
 * means.
 */

import { DatabaseSync } from 'node:sqlite';

const path = process.argv[2];

if (!path) {
  console.log(JSON.stringify({ ok: false, error: 'no path given' }));
  process.exit(0);
}

try {
  const db = new DatabaseSync(path, { readOnly: true });
  const cov = db.prepare(
    `SELECT MIN(local_date) a, MAX(local_date) b,
            COUNT(DISTINCT local_date) d, COUNT(*) n
     FROM usage_records`,
  ).get();
  const runs = db.prepare('SELECT COUNT(*) c FROM sync_log').get().c;
  const integrity = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
  db.close();

  console.log(JSON.stringify({
    ok: true,
    rows: Number(cov.n),
    first: cov.a,
    last: cov.b,
    days: Number(cov.d),
    runs: Number(runs),
    integrity: String(integrity),
  }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
}
