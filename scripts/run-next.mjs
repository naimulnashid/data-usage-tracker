/**
 * Every Next command this project runs goes through here.
 *
 *   node scripts/run-next.mjs start   # npm start: the dashboard on :7843
 *   node scripts/run-next.mjs dev     # npm run dev
 *   node scripts/run-next.mjs build   # npm run build
 *
 * Two jobs, both things Next offers no config key for:
 *
 * 1. TELEMETRY OFF, for every command. Next reports anonymous usage to Vercel
 *    from `next build` unless NEXT_TELEMETRY_DISABLED is set, and the footer
 *    has always said "no telemetry, no outbound requests" -- which was untrue
 *    until this set it (`next telemetry status` read "Enabled", 2026-09-21).
 *    Set here rather than globally with `next telemetry disable`, so it holds
 *    on any machine the repo is cloned to.
 *
 * 2. THE LISTEN ADDRESS, for start and dev. `next start` binds every interface
 *    unless told otherwise,
 * and it takes the address only as a `-H` flag -- no environment variable, no
 * config key. So a fresh install used to be reachable, password page and all,
 * from every device on whatever network the laptop joined.
 *
 * The default is now 127.0.0.1: only this machine. The Android reporter has to
 * reach the dashboard over the LAN, so using it means opting in, in
 * `.env.local`:
 *
 *   DASHBOARD_HOST=0.0.0.0
 *
 * Read from the process environment first, then `.env.local`, then `.env` --
 * the order Next itself uses -- because this runs before Next loads them.
 *
 * Next is started from THIS repo's node_modules by full path, so the listener's
 * command line still names `<repo>\node_modules\`: that is how
 * dashboard-stop.ps1 and dashboard-service.ps1 tell this dashboard from the
 * other node servers on the machine.
 *
 * 3. A NEW BUILD RESTARTS `start`. `next start` reads part of `.next` at boot
 *    and the rest lazily, so a build run under it leaves a server serving two
 *    builds at once: pages fail with the error boundary and stylesheets 404
 *    as HTML. That took By App down on every phone on 2026-10-29, a server
 *    from 13:35 serving an 18:40 build. So `start` watches `.next` and, once a
 *    build has FINISHED, restarts Next on it in place: same wrapper, same log,
 *    same command line. Pages are still broken while the build runs; nothing
 *    short of building elsewhere avoids that.
 *
 *    "Finished" is not "BUILD_ID changed": Next writes BUILD_ID before static
 *    generation, traces and manifests (`writeBuildId` in
 *    next/dist/build/index.js), so a restart on it alone boots a half-built
 *    `.next`. It is BUILD_ID changed AND nothing under `.next` written for
 *    QUIET_MS, apart from the caches the server itself writes.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = '7843';
const DEFAULT_HOST = '127.0.0.1';

/** One key out of a dotenv file, or undefined. Comments and quotes handled. */
function fromEnvFile(file, key) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return undefined;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0 || line.slice(0, eq).trim() !== key) continue;
    return line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

const host = (
  process.env.DASHBOARD_HOST
  ?? fromEnvFile('.env.local', 'DASHBOARD_HOST')
  ?? fromEnvFile('.env', 'DASHBOARD_HOST')
  ?? DEFAULT_HOST
).trim() || DEFAULT_HOST;

// An address or a host name, nothing that could smuggle in another flag.
if (!/^[A-Za-z0-9.:\-[\]]+$/.test(host)) {
  console.error(`DASHBOARD_HOST is not an address: ${JSON.stringify(host)}`);
  process.exit(1);
}

const MODES = ['start', 'dev', 'build'];
const mode = process.argv[2] ?? 'start';
if (!MODES.includes(mode)) {
  console.error(`usage: node scripts/run-next.mjs ${MODES.join('|')}`);
  process.exit(1);
}
const nextBin = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

let args;
if (mode === 'build') {
  args = [nextBin, 'build'];
} else {
  const reach = host === DEFAULT_HOST || host === 'localhost' || host === '::1'
    ? 'this machine only'
    : 'other devices on the network too (DASHBOARD_HOST)';
  console.log(`Data Usage dashboard: ${mode}, http://localhost:${PORT} -- reachable from ${reach}`);
  args = [nextBin, mode, '-p', PORT, '-H', host];
}

const DIST = join(ROOT, '.next');
const POLL_MS = 2000;
const QUIET_MS = 15000;

/** The build's id, or null while there is none (a build clears `.next` first). */
function buildId() {
  try {
    return readFileSync(join(DIST, 'BUILD_ID'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Newest write under `.next`, leaving out what a running server writes on
 * requests: `cache/` and `server/route-cache/`. Counting those, a dashboard
 * in use could hold the quiet window open forever.
 */
function newestWrite(dir = DIST) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === DIST && entry.name === 'cache') continue;
      if (dir === join(DIST, 'server') && entry.name === 'route-cache') continue;
      newest = Math.max(newest, newestWrite(path));
    } else {
      try {
        newest = Math.max(newest, statSync(path).mtimeMs);
      } catch {
        // Deleted between the listing and the stat: the build is still going.
        return Date.now();
      }
    }
  }
  return newest;
}

let child;
let restarting = false;

function run() {
  child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  // Exit with Next's own code, so the launchers see the server's outcome
  // rather than this wrapper's -- unless this wrapper stopped it to restart.
  child.on('exit', (code, signal) => {
    if (restarting) {
      restarting = false;
      run();
      return;
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

run();

// Pass Ctrl+C and stop signals through.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

if (mode === 'start') {
  let serving = buildId();
  setInterval(() => {
    const id = buildId();
    if (restarting || !id || id === serving) return;
    if (!existsSync(join(DIST, 'server'))) return;
    if (Date.now() - newestWrite() < QUIET_MS) return;
    console.log(`${stamp()}  New build ${id} (was ${serving ?? 'none'}): restarting the server on it.`);
    serving = id;
    restarting = true;
    child.kill();
  }, POLL_MS).unref();
}

/** Local time as dashboard-service.ps1 writes it, so the log reads as one. */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
