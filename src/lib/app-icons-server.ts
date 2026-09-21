import 'server-only';

/**
 * Reading `public/apps_logo/<device>/` off disk.
 *
 * Split from `app-icons.ts` because that module is imported by client
 * components (`AppTable`, `Charts`, `SplitBar`) and a `node:fs` import there
 * breaks the build. Same split, and same reason, as `queries.ts` vs the pure
 * formatting helpers.
 *
 * **Scanned per request, not once at startup.** The dashboard runs as a
 * long-lived `next start`, so a directory read cached at module load would mean
 * a new logo did not appear until the service was restarted -- which is exactly
 * the surprise this file exists to remove. A readdir of ~40 entries costs less
 * than the SQLite queries on the same page.
 *
 * The files are served by `/api/logo/[device]/[file]` rather than as static
 * assets, for the same reason -- see that route: `next start` snapshots
 * `public/` at boot, so a newly added file 404s from the static path until a
 * restart.
 */

import { readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { ICON_ALIASES, PLATE_STEMS, LOGO_ROOT, type AppIconMap } from './app-icons';

/** Extensions a browser will render inline. */
const RENDERABLE = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

/**
 * Every display name that resolves to a logo on ONE device, keyed lowercase.
 *
 * `device` is a folder under `public/apps_logo/`, named for that device's URL
 * slug -- `my-pc` for the laptop, `pixel-8` for a phone. There is
 * no shared tier and no fallback to a sibling folder -- see `app-icons.ts` for
 * why that is the point rather than an omission.
 *
 * Two passes, and the order matters: file stems first, so any file at all is
 * reachable by its own name, then aliases, so a curated pointer can override a
 * coincidental stem match.
 */
export function getAppIconMap(device: string): AppIconMap {
  let files: string[];
  try {
    files = readdirSync(join(process.cwd(), ...LOGO_ROOT, device), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    // No folder for this device is a perfectly valid state -- it is exactly
    // what a newly added phone looks like before any logo is copied in. Every
    // app falls back to its colour swatch; never let it take the page down.
    return {};
  }

  const byStem = new Map<string, { src: string; plate: boolean }>();
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!RENDERABLE.has(ext)) continue;
    const stem = basename(file, extname(file));
    byStem.set(stem.toLowerCase(), {
      // Encoded because plenty of these have spaces in them.
      src: `/api/logo/${encodeURIComponent(device)}/${encodeURIComponent(file)}`,
      plate: PLATE_STEMS.has(stem.toLowerCase()),
    });
  }

  const map: AppIconMap = {};
  for (const [stem, spec] of byStem) map[stem] = spec;
  for (const [name, stem] of Object.entries(ICON_ALIASES)) {
    const spec = byStem.get(stem.toLowerCase());
    if (spec) map[name.toLowerCase()] = spec;
  }
  return map;
}
