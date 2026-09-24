/**
 * Rasterises the install icons in `public/pwa/` from the favicon's own shapes.
 *
 *   npx tsx scripts/make-pwa-icons.ts
 *
 * The PNGs are committed, so this only needs running after the mark changes
 * (`src/app/icon.svg` -- keep the two in step by hand; the bars below are its
 * bars). PNG and not SVG because Android builds its home-screen icon from a
 * raster and ignores an SVG manifest icon.
 *
 * Two kinds, because a launcher treats them differently:
 *
 * - **any**: the favicon, rounded tile and transparent corners. Used
 *   where the icon is drawn as given -- the desktop app window, the taskbar.
 * - **maskable**: full-bleed black, the bars shrunk into the central safe zone
 *   (a circle 80% of the width). Android crops this to its own shape; handed
 *   the rounded tile instead it would crop the tile's corners off, or shrink
 *   the whole thing onto a white plate. iOS gets the same art as its
 *   `apple-touch-icon`, since it rounds the corners itself and fills any
 *   transparency with black.
 *
 * Headless Chrome (or Edge) does the drawing, as in `make-screenshots.ts`:
 * one of them is already on the machine, so this needs no image library.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_DIR = path.join(ROOT, 'public', 'pwa');

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

/** The favicon's three bars, in its 32-unit space. */
const BARS = `
  <rect x="4"  y="19" width="6" height="8"  rx="1.8" fill="#1f5fb0"/>
  <rect x="13" y="12" width="6" height="15" rx="1.8" fill="#2f80ed"/>
  <rect x="22" y="6"  width="6" height="21" rx="1.8" fill="#6fb0ff"/>`;

/**
 * `src/app/icon.svg`, tile and all -- except the rim. The favicon's is one
 * unit wide because it is drawn at 16px; scaled to 512 that is a 16px frame.
 * At 0.35 units it is ~2px at 192 and ~6px at 512.
 */
const ANY = `
  <rect width="32" height="32" rx="7" fill="#000000"/>
  <rect x="0.175" y="0.175" width="31.65" height="31.65" rx="6.825" fill="none"
        stroke="#1e1e22" stroke-width="0.35"/>
  ${BARS}`;

/**
 * The bars span x 4-28, y 6-27, centred on (16, 16.5). At 0.7 they are 16.8
 * units wide, and their corners sit 0.35 of the width from the centre --
 * inside the 0.40 safe-zone radius with room to spare.
 */
const MASKABLE = `
  <rect width="32" height="32" fill="#000000"/>
  <g transform="translate(16 16) scale(0.7) translate(-16 -16.5)">${BARS}</g>`;

const ICONS = [
  { file: 'icon-192.png', size: 192, art: ANY },
  { file: 'icon-512.png', size: 512, art: ANY },
  { file: 'icon-maskable-512.png', size: 512, art: MASKABLE },
  { file: 'apple-touch-icon.png', size: 180, art: MASKABLE },
];

function main(): void {
  if (!CHROME) throw new Error('No Chrome or Edge found. Install one, or draw the icons by hand.');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-icons-'));

  try {
    for (const { file, size, art } of ICONS) {
      const page = path.join(work, `${size}.html`);
      fs.writeFileSync(page,
        '<!doctype html><html><body style="margin:0;background:transparent">'
        + `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"`
        + ` style="display:block">${art}</svg></body></html>`);

      const out = path.join(OUT_DIR, file);
      fs.rmSync(out, { force: true });
      const run = spawnSync(CHROME, [
        '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        `--user-data-dir=${path.join(work, 'profile')}`,
        `--window-size=${size},${size}`, `--screenshot=${out}`,
        `file:///${page.replace(/\\/g, '/')}`,
      ], { stdio: 'pipe' });
      if (!fs.existsSync(out)) {
        throw new Error(`${file}: Chrome wrote no image (exit ${run.status}).\n${run.stderr}`);
      }

      // A PNG's IHDR carries width and height at bytes 16-23. Checked because
      // a headless window that came up a different size still writes a file.
      const png = fs.readFileSync(out);
      const w = png.readUInt32BE(16);
      const h = png.readUInt32BE(20);
      if (w !== size || h !== size) throw new Error(`${file}: expected ${size}x${size}, got ${w}x${h}`);
      console.log(`${file}  ${size}x${size}  ${png.length} bytes`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main();
