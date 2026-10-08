/**
 * Fold a phone's old history into the device id it reports under now.
 *
 *   npm run android:merge                                   # list phones
 *   npm run android:merge -- --from <old id> --into <new id>          # dry run
 *   npm run android:merge -- --from <old id> --into <new id> --apply
 *
 * Needed after the reporter app is UNINSTALLED and installed again -- for
 * instance moving from the debug-signed 1.2 to a release-signed build, which
 * Android refuses as an update. The reinstalled app generates a new device id,
 * so the dashboard shows the phone twice. Sync the reinstalled app once, then
 * merge the old id into the new one. See src/lib/android-merge.ts.
 *
 * --apply writes a backup beside the configured one first, with SQLite's
 * backup API, and refuses to merge if that fails.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backupDatabase, checkpointWal, openDatabase } from '../src/lib/db';
import { androidMergeCounts, mergeAndroidDevice } from '../src/lib/android-merge';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const cfg = JSON.parse(
    readFileSync(join(process.cwd(), 'config', 'collector.json'), 'utf8'),
  ) as { databasePath: string; backupPath: string };
  // --db points at a copy, for a rehearsal; its backup then lands beside it.
  const dbPath = arg('db') ?? cfg.databasePath;
  const db = openDatabase(dbPath);
  db.exec('PRAGMA busy_timeout = 8000;');

  const devices = db.prepare(`
    SELECT d.device_id, d.label, d.first_seen, d.last_seen,
           (SELECT app_version FROM android_sync_log s
             WHERE s.device_id = d.device_id ORDER BY id DESC LIMIT 1) AS app_version
      FROM android_devices d ORDER BY d.label, d.first_seen`).all();
  console.table(devices);

  const from = arg('from');
  const into = arg('into');
  if (!from || !into) {
    console.log('Pass --from <old id> --into <new id> to merge; add --apply to write.');
    return;
  }

  const counts = androidMergeCounts(db, from);
  console.log(`\nMoving from ${from} into ${into}:`);
  console.table(counts);

  if (!process.argv.includes('--apply')) {
    console.log('Dry run. Add --apply to merge.');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(
    dirname(arg('db') ? dbPath : cfg.backupPath), `data-usage.pre-merge-${stamp}.db`);
  const status = await backupDatabase(db, backupPath);
  if (status !== 'ok') throw new Error(`backup ${status}; nothing merged`);
  console.log(`Backup: ${backupPath}`);

  mergeAndroidDevice(db, from, into);
  checkpointWal(db);
  console.log('Merged. Phones now:');
  console.table(db.prepare('SELECT device_id, label, first_seen, last_seen FROM android_devices').all());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
