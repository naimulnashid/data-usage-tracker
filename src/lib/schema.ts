/**
 * Database schema.
 *
 * Every non-obvious choice here traces back to a Phase 1 finding measured
 * against the real SRUM database on 2026-08-20. See docs/DESIGN.md for the
 * write-ups; the short version is in the comments below.
 */

export const SCHEMA_VERSION = 4;

export const SCHEMA_SQL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usage_records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,

  -- SRUM stores UTC, and SrumECmd emits UTC. Verified: the newest row lagged
  -- the snapshot by exactly the local UTC+6 offset. Keep the UTC value as the
  -- source of truth and NEVER bucket days off it directly.
  timestamp_utc     TEXT    NOT NULL,

  -- Denormalised local-time buckets, computed at ingest from timestamp_utc.
  -- Without these, "usage per day" silently shifts by the UTC offset (6h here),
  -- putting early-morning traffic on the wrong day. Stored rather than computed
  -- per query so the dashboard can group and index on them directly.
  local_date        TEXT    NOT NULL,   -- YYYY-MM-DD, machine-local
  local_hour        INTEGER NOT NULL,   -- 0-23, machine-local

  -- SRUM's numeric AppId. app_id = 1 is NOT an application: it is the
  -- per-interface aggregate whose bytes equal the sum of all named apps in the
  -- same hour. Summing every row double-counts. is_aggregate exists so that
  -- mistake requires ignoring an explicit column rather than merely forgetting
  -- a filter.
  app_id            INTEGER NOT NULL,
  is_aggregate      INTEGER NOT NULL DEFAULT 0,

  -- Raw identity string exactly as SRUM gives it, plus its kind. Not called
  -- exe_path: it is an NT path, an AppX package full name, OR a service name,
  -- and non-path rows are the majority (10,943 vs 7,533 over 30 days).
  -- Display-name cleanup deliberately lives in code, not here, so the rules can
  -- change without re-ingesting.
  app_identity      TEXT    NOT NULL DEFAULT '',
  app_kind          TEXT    NOT NULL,   -- path | appx | service | aggregate | unknown

  user_id           TEXT    NOT NULL DEFAULT '',
  sid               TEXT    NOT NULL DEFAULT '',

  -- TEXT, not INTEGER. Real LUIDs exceed 2^53 (e.g. 19985273102270464), so a
  -- JS number would silently lose precision.
  interface_luid    TEXT    NOT NULL DEFAULT '',
  interface_type    TEXT    NOT NULL DEFAULT '',

  -- Which network profile. Windows' own Data usage page scopes by this, and
  -- totals differ materially on a machine that moves between networks.
  -- profile_name needs the SOFTWARE registry hive and is empty for now, so
  -- storing the id makes SSID names a later backfill rather than a re-collect.
  l2_profile_id     TEXT    NOT NULL DEFAULT '',
  profile_name      TEXT    NOT NULL DEFAULT '',

  bytes_sent        INTEGER NOT NULL,
  bytes_received    INTEGER NOT NULL,

  ingested_at       TEXT    NOT NULL
);

-- The dedup key, settled by testing candidates against 18,476 real rows:
--   time+app+sidType+iface            -> 91 collisions
--   time+appId+userId+iface           -> 91 collisions
--   +l2ProfileId                      ->  7 collisions
--   +bytes                            ->  0 collisions
-- Those last 7 were genuinely distinct measurements (11,810 vs 977,002,503
-- bytes at one timestamp) written off-cadence at sleep/shutdown, so the byte
-- values belong in the key. Idempotency still holds: a re-run produces
-- byte-identical rows that INSERT OR IGNORE skips.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_dedup
  ON usage_records(timestamp_utc, app_id, user_id, interface_luid,
                   l2_profile_id, bytes_sent, bytes_received);

CREATE INDEX IF NOT EXISTS idx_usage_local_date ON usage_records(local_date);
CREATE INDEX IF NOT EXISTS idx_usage_identity   ON usage_records(app_identity);
CREATE INDEX IF NOT EXISTS idx_usage_aggregate  ON usage_records(is_aggregate, local_date);
CREATE INDEX IF NOT EXISTS idx_usage_profile    ON usage_records(l2_profile_id);

-- One row per collector run. The reset-survival guarantee depends entirely on
-- the scheduled task actually running, so a broken task must be visible in the
-- dashboard rather than discovered after a reset has already cost the history.
CREATE TABLE IF NOT EXISTS sync_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      TEXT    NOT NULL,
  finished_at     TEXT,
  status          TEXT    NOT NULL,   -- running | success | failed
  rows_read       INTEGER NOT NULL DEFAULT 0,
  rows_inserted   INTEGER NOT NULL DEFAULT 0,
  rows_skipped    INTEGER NOT NULL DEFAULT 0,
  srum_oldest_utc TEXT,
  srum_newest_utc TEXT,
  backup_status   TEXT,
  duration_ms     INTEGER,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_started ON sync_log(started_at DESC);

-- Learned mapping from SRUM's L2ProfileId to a human network name.
--
-- SRUM stores only the numeric id. Its ProfileName column is empty, and passing
-- the SOFTWARE hive to SrumECmd (-r) does not populate it either -- verified
-- 2026-08-21 against a real 117 MB hive. The name cannot be derived from the
-- snapshot at all, so it is OBSERVED instead.
--
-- Attribution must be DEFERRED, and this is the trap. SRUM writes hourly, and
-- the VSS snapshot is missing the most recent uncommitted hour on top of that,
-- so at any moment its newest row can be well over an hour old. Pairing "the
-- network I am on now" with "the profile owning the newest row" therefore
-- attributes across a network change: switching SSID and syncing renamed a
-- profile after a network it had never carried. That happened, on real data.
--
-- So the collector only records WHAT and WHEN. Resolution happens later, once
-- SRUM has actually written the hour that observation falls in.
CREATE TABLE IF NOT EXISTS network_observations (
  observed_at TEXT PRIMARY KEY,   -- UTC ISO, when the collector saw this
  name        TEXT NOT NULL,
  interface   TEXT NOT NULL DEFAULT '',
  -- null until the hour is present in usage_records; 'ambiguous' when that hour
  -- carried more than one profile and no honest attribution is possible.
  resolved_to TEXT
);

CREATE INDEX IF NOT EXISTS idx_obs_unresolved ON network_observations(resolved_to);

-- One row per (profile, name) pair, with a vote count.
--
-- A count rather than a single name because one L2ProfileId can genuinely carry
-- several SSIDs: HomeWiFi and HomeWiFi_5G are separate WLAN profiles
-- that SRUM records under the SAME id. Overwriting on each observation made the
-- label flip-flop; counting lets the display pick the most-seen name and still
-- know the others exist.
CREATE TABLE IF NOT EXISTS network_names (
  l2_profile_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  interface     TEXT NOT NULL DEFAULT '',
  votes         INTEGER NOT NULL DEFAULT 0,
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL,
  PRIMARY KEY (l2_profile_id, name)
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

/* ======================================================================
   ANDROID
   ======================================================================

   A SEPARATE SET OF TABLES, deliberately. Not extra columns on
   usage_records, and never UNION-ed with it. Four things differ, and each
   would make a shared table lie about one side or the other:

     - The actor is a Linux uid, not an executable path. One uid can be
       several packages (uid 1000 covers 24 on this device) and one package
       can be several uids (a cloned app under user profile 999).
     - Buckets are 2 hours, not 1. Measured: bucketDuration=7200.
     - The network axis is wifi/mobile plus metered and roaming flags, not
       an L2ProfileId.
     - Rows are CUMULATIVE WITHIN A BUCKET, not immutable. See the upsert
       note on android_usage_records - this is the single biggest behavioural
       difference from the Windows side.

   Every figure here was measured by scripts/android-validate.ts against a
   real device on 2026-08-26. See docs/DESIGN.md, "The Android half".
*/

CREATE TABLE IF NOT EXISTS android_devices (
  -- Generated once by the app and stored in its own prefs. NOT the hardware
  -- serial or an advertising id: those are either unavailable without extra
  -- permissions or are identifiers this project has no business holding.
  device_id       TEXT PRIMARY KEY,
  label           TEXT    NOT NULL DEFAULT '',  -- what the dashboard shows
  brand           TEXT    NOT NULL DEFAULT '',
  model           TEXT    NOT NULL DEFAULT '',
  android_release TEXT    NOT NULL DEFAULT '',
  sdk             INTEGER NOT NULL DEFAULT 0,
  first_seen      TEXT    NOT NULL,
  last_seen       TEXT    NOT NULL
);

-- uid -> package, as the PHONE reports it.
--
-- The phone is the only thing that can answer this: it has PackageManager, so
-- it knows each package's real display label, and it knows which packages
-- share a uid. Guessing from a uid on the dashboard side is exactly what the
-- shared-uid finding rules out. The label column is what Android itself shows
-- in Settings, so no curated name table is needed on this side at all.
CREATE TABLE IF NOT EXISTS android_apps (
  device_id   TEXT    NOT NULL,
  uid         INTEGER NOT NULL,
  package     TEXT    NOT NULL,
  label       TEXT    NOT NULL DEFAULT '',
  is_system   INTEGER NOT NULL DEFAULT 0,
  -- uid / 100000. 0 is the primary user; 999 is the clone profile on this
  -- device. Stored so a cloned app is distinguishable rather than merged.
  user_profile INTEGER NOT NULL DEFAULT 0,
  first_seen  TEXT    NOT NULL,
  last_seen   TEXT    NOT NULL,
  PRIMARY KEY (device_id, uid, package)
);

CREATE INDEX IF NOT EXISTS idx_android_apps_uid ON android_apps(device_id, uid);

CREATE TABLE IF NOT EXISTS android_usage_records (
  device_id       TEXT    NOT NULL,
  uid             INTEGER NOT NULL,

  -- Bucket start, from NetworkStats. UTC is the source of truth; the local
  -- columns are denormalised at ingest for the same reason as the Windows
  -- side, and computed from the DEVICE's offset, which the app sends.
  bucket_start_utc TEXT   NOT NULL,
  local_date      TEXT    NOT NULL,
  local_hour      INTEGER NOT NULL,

  -- 'wifi' | 'mobile'. Queried separately via querySummary(networkType, ...),
  -- which is also what performs the VPN de-duplication that parsing the raw
  -- dumpsys output does not. Do not "simplify" this into one query.
  network         TEXT    NOT NULL,
  metered         INTEGER NOT NULL DEFAULT 0,
  roaming         INTEGER NOT NULL DEFAULT 0,

  rx_bytes        INTEGER NOT NULL,
  tx_bytes        INTEGER NOT NULL,
  ingested_at     TEXT    NOT NULL,

  -- No byte values in the key, and that is the opposite of the Windows side.
  --
  -- SRUM rows are immutable deltas, so identical bytes mean a duplicate and
  -- the values belong in the dedup key. A NetworkStats bucket is a RUNNING
  -- TOTAL for its 2-hour window: query it mid-window and you get a partial
  -- figure, query it again later and you get a larger one for the same key.
  -- Putting bytes in the key would store both and double-count the overlap.
  -- The ingest route upserts instead, taking the larger of the two.
  PRIMARY KEY (device_id, uid, bucket_start_utc, network, metered, roaming)
);

CREATE INDEX IF NOT EXISTS idx_android_usage_date
  ON android_usage_records(device_id, local_date);
CREATE INDEX IF NOT EXISTS idx_android_usage_uid
  ON android_usage_records(device_id, uid);

-- One row per upload from a phone, mirroring sync_log's purpose: a phone that
-- has quietly stopped reporting must be visible before its 90-day window
-- closes over the gap.
CREATE TABLE IF NOT EXISTS android_sync_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     TEXT    NOT NULL,
  received_at   TEXT    NOT NULL,
  status        TEXT    NOT NULL,   -- success | rejected
  buckets_sent  INTEGER NOT NULL DEFAULT 0,
  rows_written  INTEGER NOT NULL DEFAULT 0,
  rows_updated  INTEGER NOT NULL DEFAULT 0,
  apps_sent     INTEGER NOT NULL DEFAULT 0,
  oldest_bucket TEXT,
  newest_bucket TEXT,
  app_version   TEXT,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_android_sync_received
  ON android_sync_log(received_at DESC);

/* ----------------------------------------------------------------------
   WHICH WI-FI NETWORK, collected over adb

   Android records per-app traffic per SSID, but does NOT expose it to apps:
   every public NetworkStatsManager method takes (networkType, subscriberId),
   and android.net.NetworkTemplate -- the class that carries a wifi network key
   -- is not in the public SDK at all. Verified against android-36/android.jar.

   So this one dimension is collected over USB by
   scripts/android-ssid-collect.ts, which reads it out of the dumpsys netstats
   detail output. It is a SEPARATE table from android_usage_records for the same
   reason the Android tables are separate from the Windows ones: the two come
   from different sources with different guarantees, and a shared table would
   invite summing them.

   Two properties of the source, both measured rather than assumed:

   - **Only Wi-Fi rows carry an SSID.** Mobile has none, and neither does
     anything that crossed a VPN -- a VPN network is reported on a STACKED
     ident (transports={1, 4}) and those carry no wifiNetworkKey. Measured:
     gigabytes on stacked idents, 0 bytes of SSID-labelled traffic among them.
     Filtering to "has an SSID" therefore excludes the VPN double-count for
     free, and the price is that VPN traffic is absent from this table rather
     than mis-attributed.
   - **Rows are cumulative within a bucket**, exactly like the app's, so the
     write is the same MAX() upsert and bytes stay out of the key.
   ---------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS android_ssid_usage (
  device_id        TEXT    NOT NULL,
  uid              INTEGER NOT NULL,
  bucket_start_utc TEXT    NOT NULL,
  local_date       TEXT    NOT NULL,
  local_hour       INTEGER NOT NULL,
  ssid             TEXT    NOT NULL,
  metered          INTEGER NOT NULL DEFAULT 0,
  rx_bytes         INTEGER NOT NULL,
  tx_bytes         INTEGER NOT NULL,
  ingested_at      TEXT    NOT NULL,
  PRIMARY KEY (device_id, uid, bucket_start_utc, ssid, metered)
);

CREATE INDEX IF NOT EXISTS idx_android_ssid_date
  ON android_ssid_usage(device_id, local_date);
CREATE INDEX IF NOT EXISTS idx_android_ssid_uid
  ON android_ssid_usage(device_id, uid);
`;
