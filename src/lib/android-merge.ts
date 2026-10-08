/**
 * Fold one phone's history into another device id.
 *
 * The reporter app's device id is a random UUID in its own prefs, so
 * UNINSTALLING the app forgets it and the reinstalled app reports as a brand
 * new phone. That is unavoidable once, when moving from the debug-signed 1.2
 * to a release-signed build (Android refuses the update across keys), and any
 * time the app is uninstalled after that.
 *
 * The merge goes INTO the id the phone reports under now, so the app needs no
 * change and keeps syncing as it is. Collisions follow the ingest rules: a
 * bucket both ids hold keeps the larger reading (the reinstalled app re-sends
 * ~90 days, so most of them collide), and a rename or colour already set on
 * the new id wins over the old one.
 */
import type { DatabaseSync } from 'node:sqlite';

export interface MergeCounts {
  usage: number;
  ssid: number;
  apps: number;
  syncs: number;
  renames: number;
  colors: number;
}

const SSID_KEY = 'android_ssid_last_collect:';

export function androidMergeCounts(db: DatabaseSync, from: string): MergeCounts {
  const n = (sql: string) => Number((db.prepare(sql).get(from) as { n: number }).n);
  return {
    usage: n('SELECT COUNT(*) n FROM android_usage_records WHERE device_id = ?'),
    ssid: n('SELECT COUNT(*) n FROM android_ssid_usage WHERE device_id = ?'),
    apps: n('SELECT COUNT(*) n FROM android_apps WHERE device_id = ?'),
    syncs: n('SELECT COUNT(*) n FROM android_sync_log WHERE device_id = ?'),
    renames: n('SELECT COUNT(*) n FROM app_renames WHERE device = ?'),
    colors: n('SELECT COUNT(*) n FROM app_colors WHERE device = ?'),
  };
}

export function mergeAndroidDevice(db: DatabaseSync, from: string, into: string): MergeCounts {
  if (from === into) throw new Error('from and into are the same device');
  const exists = db.prepare('SELECT 1 FROM android_devices WHERE device_id = ?');
  for (const id of [from, into]) {
    if (!exists.get(id)) throw new Error(`no such device: ${id}`);
  }

  const counts = androidMergeCounts(db, from);
  // node:sqlite refuses a named parameter the statement does not use.
  const run = (sql: string) => db.prepare(sql).run({
    ...(sql.includes(':from') ? { from } : {}),
    ...(sql.includes(':into') ? { into } : {}),
  });

  db.exec('BEGIN IMMEDIATE');
  try {
    // `WHERE` is required before ON CONFLICT in an INSERT ... SELECT, or
    // SQLite parses the ON as a join constraint.
    run(`
      INSERT INTO android_usage_records
        (device_id, uid, bucket_start_utc, local_date, local_hour, network,
         metered, roaming, rx_bytes, tx_bytes, ingested_at)
      SELECT :into, uid, bucket_start_utc, local_date, local_hour, network,
             metered, roaming, rx_bytes, tx_bytes, ingested_at
        FROM android_usage_records WHERE device_id = :from
      ON CONFLICT(device_id, uid, bucket_start_utc, network, metered, roaming)
      DO UPDATE SET rx_bytes = MAX(rx_bytes, excluded.rx_bytes),
                    tx_bytes = MAX(tx_bytes, excluded.tx_bytes)`);
    run('DELETE FROM android_usage_records WHERE device_id = :from');

    run(`
      INSERT INTO android_ssid_usage
        (device_id, uid, bucket_start_utc, local_date, local_hour, ssid,
         metered, rx_bytes, tx_bytes, ingested_at)
      SELECT :into, uid, bucket_start_utc, local_date, local_hour, ssid,
             metered, rx_bytes, tx_bytes, ingested_at
        FROM android_ssid_usage WHERE device_id = :from
      ON CONFLICT(device_id, uid, bucket_start_utc, ssid, metered)
      DO UPDATE SET rx_bytes = MAX(rx_bytes, excluded.rx_bytes),
                    tx_bytes = MAX(tx_bytes, excluded.tx_bytes)`);
    run('DELETE FROM android_ssid_usage WHERE device_id = :from');

    // The new id's label wins: it is what the phone reports today.
    run(`
      INSERT INTO android_apps
        (device_id, uid, package, label, is_system, user_profile, first_seen, last_seen)
      SELECT :into, uid, package, label, is_system, user_profile, first_seen, last_seen
        FROM android_apps WHERE device_id = :from
      ON CONFLICT(device_id, uid, package)
      DO UPDATE SET first_seen = MIN(first_seen, excluded.first_seen),
                    last_seen  = MAX(last_seen, excluded.last_seen)`);
    run('DELETE FROM android_apps WHERE device_id = :from');

    run('UPDATE android_sync_log SET device_id = :into WHERE device_id = :from');

    for (const table of ['app_renames', 'app_colors']) {
      run(`INSERT OR IGNORE INTO ${table} (device, app_key, ${table === 'app_renames' ? 'name' : 'color'}, updated_at)
           SELECT :into, app_key, ${table === 'app_renames' ? 'name' : 'color'}, updated_at
             FROM ${table} WHERE device = :from`);
      run(`DELETE FROM ${table} WHERE device = :from`);
    }

    db.prepare(`INSERT OR IGNORE INTO meta (key, value)
                SELECT ?, value FROM meta WHERE key = ?`).run(SSID_KEY + into, SSID_KEY + from);
    db.prepare('DELETE FROM meta WHERE key = ?').run(SSID_KEY + from);

    run(`UPDATE android_devices
            SET first_seen = MIN(first_seen,
                  (SELECT first_seen FROM android_devices WHERE device_id = :from))
          WHERE device_id = :into`);
    run('DELETE FROM android_devices WHERE device_id = :from');

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return counts;
}
