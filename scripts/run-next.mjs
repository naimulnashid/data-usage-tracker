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
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

const child = spawn(process.execPath, args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
});

// Pass Ctrl+C and stop signals through, and exit with Next's own code, so the
// launchers see the server's outcome rather than this wrapper's.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
