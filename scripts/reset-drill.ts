/**
 * Phase 4 — the reset drill.
 *
 *   npx tsx scripts/reset-drill.ts [--full]
 *
 * Rehearses recovery from a Windows reset WITHOUT resetting anything. Every
 * check runs against a throwaway sandbox; the real database is only ever read.
 *
 * What a reset actually destroys: all of C:\ -- this repo, Node, SrumECmd, the
 * SRUM database itself, and the scheduled task. What survives: D:\ and whatever
 * Google Drive holds.
 *
 * So recovery depends on exactly three things, and this drill checks all three:
 *
 *   1. The backup on D:\ is intact and restorable.
 *   2. The GitHub repo alone is enough to rebuild the tooling.
 *   3. The scheduled task can be recreated.
 *
 * `--full` adds `npm ci` in the clone, which is slow but is the only way to
 * find out whether the committed lockfile still installs.
 */

import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync, rmSync, copyFileSync, existsSync, readFileSync,
  writeFileSync, mkdirSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FULL = process.argv.includes('--full');

let failures = 0;
let warnings = 0;

function step(t: string) { console.log(`\n\x1b[36m=== ${t} ===\x1b[0m`); }
function pass(m: string) { console.log(`  \x1b[32m[OK]\x1b[0m   ${m}`); }
function warn(m: string) { warnings++; console.log(`  \x1b[33m[WARN]\x1b[0m ${m}`); }
function fail(m: string) { failures++; console.log(`  \x1b[31m[FAIL]\x1b[0m ${m}`); }
function check(cond: boolean, ok: string, bad?: string) {
  if (cond) pass(ok); else fail(bad ?? ok);
}

interface Cfg {
  databasePath: string; backupPath: string; scratchDir: string;
  srumECmdDir: string; srumPath: string;
}

function readConfig(dir: string): Cfg {
  return JSON.parse(readFileSync(join(dir, 'config', 'collector.json'), 'utf8')) as Cfg;
}

interface DbInfo { rows: number; first: string; last: string; days: number; runs: number; integrity: string; indexes: string[]; tables: string[] }

function inspect(path: string): DbInfo {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const cov = db.prepare(
      'SELECT MIN(local_date) a, MAX(local_date) b, COUNT(DISTINCT local_date) d, COUNT(*) n FROM usage_records',
    ).get() as { a: string; b: string; d: number; n: number };
    return {
      rows: Number(cov.n),
      first: cov.a, last: cov.b, days: Number(cov.d),
      runs: Number((db.prepare('SELECT COUNT(*) c FROM sync_log').get() as { c: number }).c),
      integrity: String(Object.values(db.prepare('PRAGMA integrity_check').get() as object)[0]),
      indexes: (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name),
      tables: (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name),
    };
  } finally {
    db.close();
  }
}

const sandbox = mkdtempSync(join(tmpdir(), 'reset-drill-'));

try {
  console.log(`sandbox: ${sandbox}`);
  console.log(`mode   : ${FULL ? 'full (includes npm ci)' : 'fast (pass --full to also test npm ci)'}`);

  const cfg = readConfig(ROOT);

  /* ---------------------------------------------------------------- 1 */
  step('1. Does the backup survive, and is it sound?');

  check(!cfg.databasePath.toUpperCase().startsWith('C:'),
    `Live database is off the system drive (${cfg.databasePath})`,
    `Live database is on C:\\ and would NOT survive a reset: ${cfg.databasePath}`);
  check(!cfg.backupPath.toUpperCase().startsWith('C:'),
    `Backup is off the system drive (${cfg.backupPath})`,
    `Backup is on C:\\ and would NOT survive a reset: ${cfg.backupPath}`);

  // Scratch inside the synced tree would push the raw snapshot to the cloud
  // every run. Not a recovery failure, but worth catching here.
  const backupDir = dirname(resolve(cfg.backupPath));
  if (resolve(cfg.scratchDir).toUpperCase().startsWith(backupDir.toUpperCase())) {
    warn(`Scratch dir sits inside the backup tree (${cfg.scratchDir}) — it would sync to the cloud each run`);
  } else {
    pass(`Scratch dir is outside the synced tree (${cfg.scratchDir})`);
  }

  if (!existsSync(cfg.backupPath)) {
    fail(`Backup does not exist: ${cfg.backupPath} — there is nothing to restore from`);
    throw new Error('cannot continue without a backup');
  }

  const backup = inspect(cfg.backupPath);
  check(backup.integrity === 'ok', `Backup passes integrity_check`, `Backup integrity: ${backup.integrity}`);
  check(backup.rows > 0, `Backup holds ${backup.rows} rows (${backup.first} → ${backup.last}, ${backup.days} days)`);

  // A backup that has silently stopped tracking the live database is the
  // failure this whole scheme is meant to prevent, and it is invisible until
  // the moment you need it.
  if (existsSync(cfg.databasePath)) {
    const live = inspect(cfg.databasePath);
    if (backup.rows === live.rows) {
      pass(`Backup is level with the live database (${live.rows} rows)`);
    } else if (backup.rows < live.rows) {
      warn(`Backup is BEHIND the live database by ${live.rows - backup.rows} rows — a collector run may have failed after ingest`);
    } else {
      warn(`Backup has MORE rows than live (${backup.rows} vs ${live.rows}) — unexpected`);
    }
  } else {
    warn('No live database present to compare against');
  }

  /* ---------------------------------------------------------------- 2 */
  step('2. Restore into a clean machine');

  const fakeD = join(sandbox, 'PersistentData', 'data-usage');
  const fakeLive = join(fakeD, 'live', 'data-usage.db');
  mkdirSync(dirname(fakeLive), { recursive: true });

  // Plant a stale WAL sidecar at the destination first. Read-only connections
  // -- which the dashboard opens on every request -- cannot delete these on
  // close, so they genuinely outlive the database they came from. If restore
  // does not clear them, SQLite replays them against the newly copied file.
  writeFileSync(fakeLive + '-wal', Buffer.alloc(4096, 0xab));
  writeFileSync(fakeLive + '-shm', Buffer.alloc(1024, 0xcd));
  pass('Planted a stale -wal/-shm pair at the destination');

  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(fakeLive + suffix)) rmSync(fakeLive + suffix, { force: true });
  }
  copyFileSync(cfg.backupPath, fakeLive);
  pass('Restored backup → simulated live path (sidecars cleared first)');

  const restored = inspect(fakeLive);
  check(restored.integrity === 'ok', 'Restored database passes integrity_check', `integrity: ${restored.integrity}`);
  check(restored.rows === backup.rows, `Row count preserved (${restored.rows})`, `Row count changed: ${restored.rows} vs ${backup.rows}`);
  check(restored.first === backup.first && restored.last === backup.last,
    `Coverage preserved (${restored.first} → ${restored.last})`);
  check(restored.runs === backup.runs, `sync_log preserved (${restored.runs} runs)`);

  // A backup taken before its own sync_log row was finalised carries a run
  // frozen at 'running'. Because that row's timestamp is newer than the newest
  // 'success', a restored database reports the last successful collection as
  // older than it really was -- on the one page whose entire job is telling you
  // whether collection is still happening.
  const rdb = new DatabaseSync(fakeLive, { readOnly: true });
  const stuck = (rdb.prepare(
    "SELECT COUNT(*) c FROM sync_log WHERE status = 'running'",
  ).get() as { c: number }).c;
  const newestSuccess = (rdb.prepare(
    "SELECT MAX(started_at) t FROM sync_log WHERE status = 'success'",
  ).get() as { t: string | null }).t;
  const newestAny = (rdb.prepare(
    'SELECT MAX(started_at) t FROM sync_log',
  ).get() as { t: string | null }).t;
  rdb.close();

  check(Number(stuck) === 0,
    'No run is stuck at "running" in the backup',
    `${stuck} run(s) stuck at "running" — the backup was taken before its own log row was finalised`);
  check(newestSuccess === newestAny,
    'Newest logged run is a successful one',
    `Newest run (${newestAny}) is not the newest success (${newestSuccess}) — Sync Status would under-report freshness`);

  // Indices are not cosmetic here: the UNIQUE dedup index is what makes the
  // collector idempotent. A restore that dropped it would look fine and then
  // duplicate every row on the next scheduled run.
  const needIndexes = ['idx_usage_dedup', 'idx_usage_local_date', 'idx_usage_aggregate'];
  const missingIdx = needIndexes.filter((i) => !restored.indexes.includes(i));
  check(missingIdx.length === 0,
    `All ${restored.indexes.length} indexes survived, including the UNIQUE dedup index`,
    `Missing index(es) after restore: ${missingIdx.join(', ')}`);

  const needTables = ['usage_records', 'sync_log', 'meta'];
  const missingTbl = needTables.filter((t) => !restored.tables.includes(t));
  check(missingTbl.length === 0, `Tables intact: ${restored.tables.join(', ')}`, `Missing table(s): ${missingTbl.join(', ')}`);

  /* ---------------------------------------------------------------- 3 */
  step('3. Does the restored database still dedup?');

  // The real test of a restore: run the collector's ingest against it. If the
  // UNIQUE index came through, re-ingesting known-present data inserts nothing.
  const csvDir = join(sandbox, 'csv');
  mkdirSync(csvDir, { recursive: true });

  const db = new DatabaseSync(fakeLive, { readOnly: true });
  const sample = db.prepare(
    `SELECT timestamp_utc, app_id, app_identity, user_id, sid, interface_luid,
            interface_type, l2_profile_id, bytes_sent, bytes_received
     FROM usage_records ORDER BY id LIMIT 200`,
  ).all() as Record<string, string | number>[];
  db.close();

  const header = 'Id,Timestamp,ExeInfo,ExeInfoDescription,ExeTimestamp,SidType,Sid,UserName,UserId,AppId,BytesReceived,BytesSent,InterfaceLuid,InterfaceType,L2ProfileFlags,L2ProfileId,ProfileName';
  const lines = [header];
  sample.forEach((r, i) => {
    // Back to SrumECmd's own format: space-separated UTC, no trailing Z.
    const ts = String(r['timestamp_utc']).replace('T', ' ').replace(/\.\d+Z$/, '');
    const exe = String(r['app_identity']);
    const quoted = exe.includes(',') ? `"${exe.replace(/"/g, '""')}"` : exe;
    lines.push([
      i + 1, ts, quoted, '', '', '1', r['sid'], '', r['user_id'], r['app_id'],
      r['bytes_received'], r['bytes_sent'], r['interface_luid'], r['interface_type'],
      '0', r['l2_profile_id'], '',
    ].join(','));
  });
  writeFileSync(join(csvDir, '20260821_SrumECmd_NetworkUsages_Output.csv'), lines.join('\n'), 'utf8');

  const out = execFileSync(
    process.execPath,
    ['--import', 'tsx', join(ROOT, 'scripts', 'ingest.ts'),
     '--csv', csvDir, '--db', fakeLive, '--no-backup', '--allow-system-drive'],
    { cwd: ROOT, encoding: 'utf8' },
  );

  const inserted = Number(/inserted:\s*(\d+)/.exec(out)?.[1] ?? -1);
  const skipped = Number(/skipped\s*:\s*(\d+)/.exec(out)?.[1] ?? -1);
  check(inserted === 0 && skipped === sample.length,
    `Re-ingesting ${sample.length} known rows inserted 0 and skipped ${skipped} — dedup survived the restore`,
    `Dedup broken after restore: inserted ${inserted}, skipped ${skipped} of ${sample.length}`);

  const after = inspect(fakeLive);
  check(after.rows === restored.rows, `Row count unchanged after re-ingest (${after.rows})`);

  /* ---------------------------------------------------------------- 4 */
  step('4. Is the repo alone enough to rebuild the tooling?');

  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);

  const essential = [
    'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.mjs',
    'config/collector.json',
    'scripts/collector.ps1', 'scripts/srum-recover.ps1',
    // The elevated half, deployed by register-task.ps1. Without them the
    // snapshot task cannot be rebuilt and nothing collects.
    'scripts/srum-snapshot.ps1', 'scripts/protected-dir.ps1',
    'scripts/register-task.ps1', 'scripts/restore.ps1',
    'scripts/ingest.ts', 'scripts/stats.ts',
    'scripts/dashboard-service.ps1', 'scripts/dashboard-hidden.vbs',
    'scripts/install-autostart.ps1', 'scripts/dashboard-stop.ps1',
    // Both launchers delegate their build check to this one script, so a
    // restored tree without it starts nothing.
    'scripts/ensure-build.ps1',
    'src/lib/schema.ts', 'src/lib/srum.ts', 'src/lib/db.ts',
    'src/lib/csv.ts', 'src/lib/app-name.ts', 'src/lib/queries.ts',
    'src/app/layout.tsx', 'src/app/(dash)/layout.tsx',
    // The laptop's overview. It lives under its slug like every other
    // device; `src/app/page.tsx` is only the redirect kept for old bookmarks,
    // so naming that one here would pass while the real page was missing.
    'src/app/(dash)/windows/[device]/page.tsx', 'src/lib/nav.ts',
    'src/app/globals.css', 'src/app/icon.svg',
    'src/lib/auth.ts', 'src/middleware.ts', 'src/app/login/page.tsx',
    'src/app/api/login/route.ts', 'src/app/api/sync/route.ts',
    'src/components/ActivityHeatmap.tsx', 'src/components/SyncButton.tsx',
    '.env.example',
    'README.md',
    // The launcher every `npm start`/`dev`/`build` goes through. Without it
    // none of them run.
    'scripts/run-next.mjs',
  ];
  const missing = essential.filter((f) => !tracked.includes(f));
  check(missing.length === 0,
    `All ${essential.length} essential files are committed`,
    `NOT committed, so a fresh clone could not rebuild: ${missing.join(', ')}`);

  // The opposite failure: collected data reaching the repo.
  const leaked = tracked.filter((f) => /\.(db|dat|csv|sqlite3?)$/i.test(f));
  check(leaked.length === 0, 'No collected data is tracked in the repo', `Data files committed: ${leaked.join(', ')}`);

  const clonePath = join(sandbox, 'clone');
  let cloned = false;
  try {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', ROOT, clonePath], { encoding: 'utf8', stdio: 'pipe' });
    cloned = true;
    pass('Repo clones cleanly');
  } catch (e) {
    fail(`Clone failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (cloned) {
    const cloneCfg = readConfig(clonePath);
    check(cloneCfg.backupPath === cfg.backupPath,
      'Cloned config points at the same backup path — no hand-editing needed after a reset');

    // Uncommitted local edits are exactly what a reset would silently discard.
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
    check(dirty === '',
      'Working tree is clean — nothing would be lost with the C: drive',
      `Uncommitted changes would be LOST in a reset:\n${dirty.split('\n').map((l) => '           ' + l).join('\n')}`);

    const unpushed = execFileSync('git', ['log', '--oneline', '@{u}..HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    check(unpushed === '',
      'All commits are pushed to the remote',
      `Unpushed commits would be LOST in a reset:\n${unpushed}`);

    if (FULL) {
      console.log('  running npm ci in the clone (slow)...');
      try {
        // Invoke npm's JS entry point with the current node binary.
        //
        // Neither obvious alternative works on Windows: `shell: true` passes
        // args through a shell unescaped (Node deprecation DEP0190), and
        // spawning `npm.cmd` without a shell fails outright with EINVAL, since
        // Node refuses to exec .cmd/.bat directly. Running npm-cli.js sidesteps
        // both.
        const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
        if (!existsSync(npmCli)) throw new Error(`npm-cli.js not found at ${npmCli}`);
        execFileSync(process.execPath,
          [npmCli, 'ci', '--silent', '--no-audit', '--no-fund'],
          { cwd: clonePath, encoding: 'utf8', stdio: 'pipe' });
        pass('npm ci succeeds from the committed lockfile');
      } catch (e) {
        fail(`npm ci failed — a fresh machine could not install: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      warn('Skipped npm ci — re-run with --full to verify the lockfile installs');
    }
  }

  /* --------------------------------------------------------------- 4b */
  step('4b. Will the PowerShell scripts parse on a fresh machine?');

  // Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI, not UTF-8. An em-dash
  // then decodes to CP1252 0x94 = U+201D -- which PowerShell accepts as a STRING
  // DELIMITER. It closes the string early and silently breaks the enclosing
  // block: a -DryRun guard stopped firing and the script performed a real
  // restore instead. Nothing errors; the logic just quietly changes.
  //
  // Keeping .ps1 files pure ASCII sidesteps the whole class of problem, and
  // does not depend on an editor preserving a BOM.
  for (const rel of ['scripts/collector.ps1', 'scripts/srum-recover.ps1',
                     'scripts/srum-snapshot.ps1', 'scripts/protected-dir.ps1',
                     'scripts/register-task.ps1',
                     'scripts/restore.ps1', 'scripts/phase1-validate.ps1',
                     'scripts/dashboard-service.ps1', 'scripts/dashboard-stop.ps1',
                     'scripts/ensure-build.ps1',
                     'scripts/install-autostart.ps1', 'scripts/observe-network.ps1']) {
    const full = join(ROOT, rel);
    if (!existsSync(full)) { warn(`${rel} is missing`); continue; }
    const buf = readFileSync(full);
    const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const nonAscii: number[] = [];
    for (let i = 0; i < buf.length; i++) if (buf[i]! > 0x7f) nonAscii.push(i);
    if (nonAscii.length === 0) {
      pass(`${rel} is pure ASCII`);
    } else if (hasBom) {
      warn(`${rel} has ${nonAscii.length} non-ASCII byte(s); a BOM saves it, but the BOM must survive every future edit`);
    } else {
      fail(`${rel} has ${nonAscii.length} non-ASCII byte(s) and no BOM -- PowerShell 5.1 will misparse it`);
    }
  }

  /* ---------------------------------------------------------------- 5 */
  step('5. Can the scheduled tasks be recreated?');

  // Two tasks since the privilege split of 2026-09-21: the collector, which
  // must NOT be elevated because it runs repo code the user can edit, and the
  // snapshot task, which must be, and runs only an admin-owned copy.
  const readTaskXml = (name: string): string | null => {
    const xmlPath = join(ROOT, 'scripts', 'task', `${name}.xml`);
    if (!existsSync(xmlPath)) {
      warn(`No exported "${name}" XML — recovery relies entirely on re-running register-task.ps1`);
      return null;
    }
    const bytes = readFileSync(xmlPath);
    check(bytes[0] === 0xff && bytes[1] === 0xfe,
      `"${name}" XML is UTF-16 LE, as schtasks /create /xml requires`,
      `"${name}" XML is NOT UTF-16 — schtasks would reject it as malformed`);
    const xml = bytes.toString('utf16le').replace(/^\uFEFF/, '');

    // The known limitation, asserted rather than assumed.
    const sid = /<UserId>([^<]+)<\/UserId>/.exec(xml)?.[1] ?? '';
    if (/^S-1-5-21-/.test(sid)) {
      warn(`"${name}" XML embeds this install's user SID, which a reset invalidates — recover by re-running register-task.ps1, not by importing the XML`);
    }
    return xml;
  };
  const scriptInXml = (xml: string): string | undefined =>
    /-File "([^"]+)"/.exec(/<Arguments>([^<]+)<\/Arguments>/.exec(xml)?.[1] ?? '')?.[1];

  const collectorXml = readTaskXml('Data Usage Collector');
  if (collectorXml) {
    check(/<Command>[^<]*powershell\.exe<\/Command>/i.test(collectorXml), 'Collector task invokes powershell.exe');
    check(/<StartWhenAvailable>true<\/StartWhenAvailable>/.test(collectorXml), 'Collector task catches up on missed runs');
    check(!/<RunLevel>HighestAvailable<\/RunLevel>/.test(collectorXml),
      'Collector task runs unelevated',
      'Collector task runs ELEVATED while executing repo code the user can edit — re-run register-task.ps1');
    const pathInXml = scriptInXml(collectorXml);
    if (pathInXml) {
      check(existsSync(pathInXml),
        'Collector task points at a collector script that exists',
        `Collector task references a missing path: ${pathInXml}`);
      if (pathInXml !== join(ROOT, 'scripts', 'collector.ps1')) {
        warn(`Collector task hardcodes ${pathInXml} — the repo must be cloned to that exact path, or re-register`);
      }
    }
  }

  const snapshotXml = readTaskXml('Data Usage Snapshot');
  if (snapshotXml) {
    check(/<RunLevel>HighestAvailable<\/RunLevel>/.test(snapshotXml),
      'Snapshot task runs elevated, as esentutl /vss requires');
    const pathInXml = scriptInXml(snapshotXml) ?? '';
    check(/\\ProgramData\\DataUsageTracker\\bin\\srum-snapshot\.ps1$/i.test(pathInXml),
      'Snapshot task runs the admin-owned deployed copy, not the repo\'s',
      `Snapshot task runs ${pathInXml || 'an unknown script'}, which is not the admin-owned deployed copy`);
    // Expected to be missing on a rebuilt machine: register-task.ps1 deploys it.
    if (pathInXml && !existsSync(pathInXml)) {
      warn(`${pathInXml} is not deployed — register-task.ps1 recreates it`);
    }
  }

  /* ---------------------------------------------------------------- 6 */
  step('6. External prerequisites a reset removes');

  const prereqs: [string, boolean, string][] = [
    ['SrumECmd', existsSync(join(cfg.srumECmdDir, 'SrumECmd.exe')), `download from ericzimmerman.github.io to ${cfg.srumECmdDir}`],
    ['SRUM database', existsSync(cfg.srumPath), 'a fresh Windows install recreates this automatically, empty'],
  ];
  for (const [name, ok, hint] of prereqs) {
    if (ok) pass(`${name} present`);
    else warn(`${name} missing — after a reset: ${hint}`);
  }

  let nodeVer = '';
  try { nodeVer = execFileSync(process.execPath, ['--version'], { encoding: 'utf8' }).trim(); } catch { /* ignore */ }
  const major = Number(/^v(\d+)/.exec(nodeVer)?.[1] ?? 0);
  check(major >= 22, `Node ${nodeVer} supports the built-in node:sqlite (needs 22+)`, `Node ${nodeVer} is too old for node:sqlite`);

  const backupAgeH = (Date.now() - statSync(cfg.backupPath).mtimeMs) / 3_600_000;
  if (backupAgeH > 48) warn(`Backup is ${Math.round(backupAgeH)}h old — the collector may have stopped`);
  else pass(`Backup is ${Math.round(backupAgeH)}h old`);

} catch (err) {
  fail(`Drill aborted: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

step('Result');
if (failures === 0 && warnings === 0) {
  console.log('  \x1b[32mReset-survival verified. No failures, no warnings.\x1b[0m');
} else if (failures === 0) {
  console.log(`  \x1b[32mReset-survival verified\x1b[0m, with \x1b[33m${warnings} warning(s)\x1b[0m to read above.`);
} else {
  console.log(`  \x1b[31m${failures} FAILURE(S)\x1b[0m and ${warnings} warning(s). Recovery is NOT safe until these are fixed.`);
}
console.log('');
process.exitCode = failures === 0 ? 0 : 1;
