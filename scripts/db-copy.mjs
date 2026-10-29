/**
 * Write a consistent single-file copy of a usage database.
 *
 *   node scripts/db-copy.mjs <source.db> <dest>
 *
 * For restore.ps1, which must keep the database it is about to replace. In
 * WAL mode the newest committed rows can live only in `<db>-wal`, so moving
 * the main file aside on its own keeps a copy that is missing them. SQLite's
 * backup API, run over a read-only connection, reads through the WAL and
 * writes one self-contained file -- the same way the backup itself is made.
 *
 * Refuses to overwrite `dest`. Always exits 0 and prints one line of JSON;
 * the caller decides what a failure means, as with db-info.mjs.
 */

import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync } from 'node:fs';

const [source, dest] = process.argv.slice(2);

if (!source || !dest) {
  console.log(JSON.stringify({ ok: false, error: 'usage: db-copy.mjs <source.db> <dest>' }));
  process.exit(0);
}
if (existsSync(dest)) {
  console.log(JSON.stringify({ ok: false, error: `destination exists: ${dest}` }));
  process.exit(0);
}

try {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, dest);
  } finally {
    db.close();
  }
  console.log(JSON.stringify({ ok: true }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
}
