# Project site

The one-page site for people who find the repository: the problem it solves,
what it does, every chart the dashboard draws (live), how it works, how to
install it, and a short FAQ. Built on the **Onyx** design system, on the same
structure as the AI Usage site.

| | |
|---|---|
| Built with | [Astro](https://astro.build) 7, static output; Geist from Fontsource, self-hosted |
| Design | Onyx tokens in `src/styles/onyx.css`, copied unchanged from the Onyx repo: refresh it there, never edit it here |
| Light theme | **A grey page (`#e6e6ea`) behind white cards**, the owner's choice for the AI Usage site (2026-10-28) applied here too: Onyx's light canvas reads as nearly white. Overridden in `src/styles/global.css`, not in `onyx.css` |
| Accent | **The dashboard's own: Tech Blue for the laptop, Android Green for a phone** (`src/lib/accent.ts` in the dashboard), not Onyx's. `data-device` on `<html>` or a section picks the family, as on the dashboard's shell |
| Icons | Lucide 1.61.0 shapes inlined in `src/components/Icon.astro`; no icon library ships |
| Charts | `src/scripts/charts.js`: drawn from a fixed seed, so the same on every load and nobody's usage; they follow the dashboard's (`src/components/Charts.tsx`, `WhereItWent.tsx`). `src/styles/charts.css` maps the dashboard's chart tokens onto Onyx's |
| Screenshots | Imported from `docs/screenshots/` (`npm run demo:shots` in the repo root); Astro resizes them, crops the first screen of each, and serves the dark or light one by theme |

`?device=android` opens the chart gallery on the phone.

**Phones get the desktop layout, zoomed out to fit**: a `width=1280` viewport,
as on the AI Usage site. The narrow styles stay for a narrow desktop window.

## Build and preview

Needs Node.js 22.12 or newer (Astro's `engines`). From `site\`:

```bash
npm ci
npm run build
npm run preview
```

`npm run build` writes `dist/` (git-ignored) and then runs
`scripts/check-csp.mjs`, which fails if the page holds an inline script the
Content-Security-Policy does not allow (below). `npm run preview` serves
`dist/` at http://localhost:4321.

## Deploying on Vercel

Root Directory `site`; everything else is in `vercel.json`: the Astro build,
the security headers and when to build at all.

- **CSP.** Scripts load only from the site itself, plus the one inline theme
  snippet in `src/layouts/Base.astro` (it must run before first paint), allowed
  by its hash. Edit that snippet and the build prints the new hash to put in
  `vercel.json`. Astro is told never to inline anything else
  (`assetsInlineLimit: 0`). Styles allow `'unsafe-inline'`: the charts colour
  their shapes through style attributes.
- **A push builds only when the site could have changed**: something under
  `site/`, `docs/screenshots/`, `docs/social-preview.png` or the root
  `package.json` (the footer's version) differs from the last successful
  deployment (`ignoreCommand`; exit 0 skips). With no previous deployment it
  builds. Any other folder the site starts reading from must be added to that
  list.
- Link previews use the repository's social card (`docs/social-preview.png`),
  with absolute URLs from `VERCEL_PROJECT_PRODUCTION_URL`.
