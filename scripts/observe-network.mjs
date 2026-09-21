/**
 * Record which network this machine is on, and resolve what can be resolved.
 *
 *   node scripts/observe-network.mjs --name "<SSID>" --interface "<alias>"
 *
 * Runs every 15 minutes from the "Data Usage Network Watch" task. Cheap: no
 * snapshot, no parse, just one insert and a resolver pass.
 *
 * WHY IT IS SEPARATE FROM THE COLLECTOR
 *
 * Names are observed, not derived -- SRUM stores only a numeric profile id. An
 * observation resolves only once the hour it falls in has been written AND that
 * hour carries exactly one profile; an hour spanning a network change is
 * ambiguous and gets dropped rather than guessed.
 *
 * The collector runs daily, so it samples once a day. That is far too coarse:
 * on 2026-08-21 every observation of the home network happened to land in the one
 * hour the machine switched networks, so all three were ambiguous and the SSID
 * was never learned -- even though hours 04Z and 05Z were clean and would have
 * resolved instantly. Sampling four times an hour means a stable hour is caught
 * almost immediately.
 *
 * The collector itself cannot simply run more often: it VSS-copies a ~99 MB
 * database each time. That is why this is a separate, tiny task.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const name = arg('name');
const iface = arg('interface') ?? '';

if (!name) {
  console.log('no network name given - nothing to record');
  process.exit(0);
}

const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'collector.json'), 'utf8'));
const db = new DatabaseSync(cfg.databasePath);

try {
  // Same schema the collector uses. If the collector has never run there is no
  // table yet, and there is nothing to attribute an observation to anyway.
  const hasTable = db
    .prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='network_observations'")
    .get().c;
  if (!hasTable) {
    console.log('no network_observations table yet - run the collector first');
    process.exit(0);
  }

  const observedAt = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO network_observations (observed_at, name, interface)
     VALUES (?, ?, ?)`,
  ).run(observedAt, name, iface);

  // Resolve anything now resolvable. Identical rule to ingest.ts: the hour must
  // exist and must carry exactly one profile.
  const pending = db
    .prepare('SELECT observed_at, name, interface FROM network_observations WHERE resolved_to IS NULL')
    .all();

  let resolved = 0;
  let ambiguous = 0;

  for (const obs of pending) {
    const hour = obs.observed_at.slice(0, 13);
    const profiles = db
      .prepare(
        `SELECT DISTINCT l2_profile_id p FROM usage_records
         WHERE substr(timestamp_utc, 1, 13) = ? AND l2_profile_id NOT IN ('', '0')`,
      )
      .all(hour);

    if (profiles.length === 0) continue;

    if (profiles.length > 1) {
      db.prepare("UPDATE network_observations SET resolved_to = 'ambiguous' WHERE observed_at = ?")
        .run(obs.observed_at);
      ambiguous++;
      continue;
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO network_names (l2_profile_id, name, interface, votes, first_seen, last_seen)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(l2_profile_id, name) DO UPDATE SET
         votes = network_names.votes + 1,
         last_seen = excluded.last_seen`,
    ).run(profiles[0].p, obs.name, obs.interface, now, now);

    db.prepare('UPDATE network_observations SET resolved_to = ? WHERE observed_at = ?')
      .run(profiles[0].p, obs.observed_at);

    console.log(`resolved: ${obs.name} -> profile ${profiles[0].p}`);
    resolved++;
  }

  console.log(
    `observed ${name} (${iface || 'unknown interface'}); ` +
      `${pending.length} pending, ${resolved} resolved, ${ambiguous} ambiguous`,
  );
} finally {
  db.close();
}
