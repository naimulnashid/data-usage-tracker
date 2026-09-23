/**
 * Captures the README's screenshots from a dashboard serving the demo history.
 *
 *   npm run demo:data                (writes ./demo-data)
 *   npm run build                    (the shots show the BUILT dashboard)
 *   npm run demo:shots               (writes docs/screenshots/*.webp)
 *   npm run demo:shots -- <demo-dir> (when demo:data was given one)
 *
 * Paired with `make-demo-data.ts`, and only meaningful with it: a screenshot of
 * this dashboard is otherwise a screenshot of somebody's real usage. This
 * starts its OWN dashboard on 127.0.0.1:7899, pointed at the demo database
 * with DATA_USAGE_CONFIG, captures each page, and stops it. The dashboard on
 * 7843 and its database are never touched.
 *
 * It never handles anyone's password. The demo server gets a random one for
 * its lifetime, and the session cookie is minted from it with the dashboard's
 * own `issueSession()` -- the derivation the login route uses. The real
 * `.env.local` is still loaded by Next, so its password and ingest token are
 * overridden in the child's environment rather than inherited.
 *
 * Chrome (or Edge) over the DevTools protocol rather than a screenshot
 * library: one of them is already on the machine, Node has a WebSocket, and
 * this needs no dependency to keep current for something run a few times a
 * year.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { issueSession, SESSION_COOKIE } from '../src/lib/auth.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEMO_DIR = path.resolve(process.argv[2] ?? path.join(ROOT, 'demo-data'));
const DEMO_CONFIG = path.join(DEMO_DIR, 'collector.json');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');

const SERVER_PORT = 7899;
const DEBUG_PORT = 9334;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;

const CHROME = [
  `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['LOCALAPPDATA']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => fs.existsSync(p));

/**
 * The window each page loads in: wide enough that the sidebar is open. Only
 * the width survives into the image -- each shot is the WHOLE page, top to
 * footer, taken by growing the window to the page's height (see below).
 */
const VIEWPORT = { width: 1440, height: 900 };
/** Captured at 2x, so the images stay sharp on a high-density screen. */
const SCALE = 2;

interface Shot {
  name: string;
  path: string;
}

/**
 * The only devices a demo page may list. Checked on every page before it is
 * captured: a build from before DATA_USAGE_CONFIG existed would ignore it and
 * serve the REAL database, and this is what stops that becoming a committed
 * image rather than an error.
 */
const DEMO_DEVICES = ['My PC', 'Pixel 8'];

/**
 * Slugs come from the demo's labels: "My PC" and the phone "Pixel 8".
 *
 * One shot per page. There used to be six viewport-sized shots, two of them a
 * second look at an overview scrolled to a lower card ("Activity", "Where it
 * went"); a full-page capture already contains those.
 */
const SHOTS: Shot[] = [
  { name: 'windows-overview', path: '/windows/my-pc' },
  { name: 'windows-apps', path: '/windows/my-pc/apps' },
  { name: 'windows-app-detail', path: '/windows/my-pc/apps/edge' },
  { name: 'android-overview', path: '/android/pixel-8' },
];

/* ------------------------------------------------------------------ CDP -- */

class Cdp {
  private ws!: WebSocket;
  private next = 1;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();

  static async attach(wsUrl: string): Promise<Cdp> {
    const cdp = new Cdp();
    cdp.ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      cdp.ws.addEventListener('open', () => resolve(), { once: true });
      cdp.ws.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
    });
    cdp.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as {
        id?: number; result?: Record<string, unknown>; error?: { message: string };
      };
      const waiter = msg.id ? cdp.pending.get(msg.id) : undefined;
      if (!waiter) return;
      cdp.pending.delete(msg.id!);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result ?? {});
    });
    return cdp;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate<T>(expression: string): Promise<T> {
    const res = (await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    })) as { result?: { value?: T } };
    return res.result?.value as T;
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    return res.status > 0;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- server -- */

function startDemoServer(password: string): ChildProcess {
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  return spawn(process.execPath, [nextBin, 'start', '-p', String(SERVER_PORT), '-H', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: {
      ...process.env,
      DATA_USAGE_CONFIG: DEMO_CONFIG,
      // Set, so Next's .env.local loading cannot supply the real values: it
      // never overrides a variable the process already has.
      DASHBOARD_PASSWORD: password,
      ANDROID_INGEST_TOKEN: '',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });
}

/* ----------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  if (!fs.existsSync(DEMO_CONFIG)) {
    throw new Error(`No demo data at ${DEMO_DIR}. Run \`npm run demo:data\` first.`);
  }
  if (!fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
    throw new Error('No build. Run `npm run build` first; the shots show the built dashboard.');
  }
  if (!CHROME) throw new Error('No Chrome or Edge found. Install one, or take the shots by hand.');
  if (await answers(`${BASE}/login`)) {
    throw new Error(`Something already answers on ${BASE}. Stop it, or change SERVER_PORT.`);
  }

  const password = randomBytes(24).toString('base64url');
  const { value } = await issueSession(password);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = startDemoServer(password);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-shots-'));
  let browser: ChildProcess | null = null;

  try {
    for (let i = 0; i < 120 && !(await answers(`${BASE}/login`)); i++) await sleep(250);
    if (!(await answers(`${BASE}/login`))) throw new Error('The demo server never came up');

    browser = spawn(CHROME, [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--hide-scrollbars',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ], { stdio: 'ignore' });

    let target: { webSocketDebuggerUrl: string } | null = null;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(250);
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
        if (res.ok) target = (await res.json()) as { webSocketDebuggerUrl: string };
      } catch {
        // Not listening yet.
      }
    }
    if (!target) throw new Error('The browser never opened its debugging port');

    const cdp = await Cdp.attach(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: SCALE, mobile: false });
    await cdp.send('Network.setCookie', {
      name: SESSION_COOKIE, value, domain: '127.0.0.1', path: '/', httpOnly: true,
    });

    for (const shot of SHOTS) {
      await cdp.send('Page.navigate', { url: `${BASE}${shot.path}` });

      // Loaded means: the streamed page replaced its skeleton, the sidebar has
      // read its collapsed state, and every chart has drawn its surface.
      let loaded = false;
      for (let i = 0; i < 160 && !loaded; i++) {
        await sleep(250);
        loaded = await cdp.evaluate<boolean>(`(() => {
          if (location.pathname !== ${JSON.stringify(shot.path)}) return false;
          if (!document.querySelector('main#content h1')) return false;
          if (document.querySelector('.skeleton')) return false;
          if (!document.querySelector('.sidebar[data-ready="true"]')) return false;
          const figures = [...document.querySelectorAll('[role=figure]')];
          return figures.every((f) => !f.querySelector('.recharts-responsive-container')
            || f.querySelector('svg.recharts-surface'));
        })()`);
      }
      if (!loaded) throw new Error(`${shot.path} never finished rendering (signed in? demo data present?)`);

      const devices = await cdp.evaluate<string[]>(
        `[...document.querySelectorAll('.side-device')].map((a) => (a.getAttribute('aria-label') || a.textContent || '').split(',')[0].trim())`,
      );
      const sameSet = devices.length === DEMO_DEVICES.length && DEMO_DEVICES.every((d) => devices.includes(d));
      if (!sameSet) {
        throw new Error(
          `${shot.path} lists devices ${JSON.stringify(devices)}, not the demo's ${JSON.stringify(DEMO_DEVICES)}. ` +
            'This is not the demo database -- is the build older than DATA_USAGE_CONFIG? Run `npm run build`. ' +
            'Nothing was captured from this page.',
        );
      }

      // CSS entry animations first; then the JS ones document.getAnimations()
      // cannot see -- the 900 ms count-ups and the chart draw-ins.
      for (let i = 0; i < 20; i++) {
        const settled = await cdp.evaluate<boolean>(
          `document.getAnimations().every((a) => a.playState === 'finished')`,
        );
        if (settled) break;
        await sleep(150);
      }
      await sleep(1200);

      // The whole page: grow the window to the document's height and capture
      // that. `captureBeyondViewport` is not used because it renders the
      // overflow without re-laying out the page, and the sticky sidebar and
      // top bar are pinned to the viewport -- they would stop at 900px and
      // leave the rest of the image without them. A window as tall as the
      // page has neither problem. The height is re-read until it holds,
      // because growing the window can itself move it (anything sized in vh).
      let height = 0;
      for (let i = 0; i < 5; i++) {
        const h = await cdp.evaluate<number>('Math.ceil(document.documentElement.scrollHeight)');
        if (h === height) break;
        height = h;
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: VIEWPORT.width, height, deviceScaleFactor: SCALE, mobile: false,
        });
        await sleep(500);
      }

      // WebP: a 2x capture of a dark UI is several times smaller than PNG at
      // no visible cost, and the browser encodes it, so what this writes is
      // exactly what is committed.
      const res = (await cdp.send('Page.captureScreenshot', {
        format: 'webp', quality: 92, captureBeyondViewport: false,
      })) as { data: string };

      // Back to the loading window, so the next page lays out as a browser would.
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: SCALE, mobile: false });
      const file = path.join(OUT_DIR, `${shot.name}.webp`);
      fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
      console.log(`  ${path.relative(ROOT, file)}  ${VIEWPORT.width}x${height}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
    }

    cdp.close();
  } finally {
    browser?.kill();
    server.kill();
    // The browser holds its profile open for a moment after kill(), and a
    // failure to delete a temp folder must not mask why the run failed.
    await sleep(700);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      // A leftover temp profile is the OS's to clean.
    }
  }
}

main().catch((err: unknown) => {
  console.error(`\nScreenshots failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
