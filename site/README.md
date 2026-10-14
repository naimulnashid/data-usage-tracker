# Project site

A one-page site that shows what this project is and does, for people who
find the repository: the problem it solves, how the collectors work, every
chart it draws, and every feature.

**The screenshot tour is hidden** (2026-10-15, pending the owner's review):
its section, nav link and script are all kept, and the comment above
`<section id="tour">` in `index.html` says how to bring it back.

Plain HTML, CSS and one script, with no framework and no dependencies. The
charts are drawn in the browser from a fixed random seed, so they are the
same on every load and are nobody's usage. The dashboard screenshots come
from `docs/screenshots/`, which `npm run demo:shots` regenerates in both
themes from one history; the (hidden) tour shows the set matching the
page's theme, and
the build copies them in rather than keeping a second set here. It copies
`docs/social-preview.png` (the repository's social card) in the same way, as
the link preview image; the preview tags use absolute URLs to the deployed
address, since link unfurlers need them.

**Phones get the desktop layout, zoomed to fit**, as the dashboard does: the
viewport tag is `width=1024` with no initial scale, so a phone lays the page
out 1024px wide and scales it down. Desktop browsers ignore the tag. The
narrow-width CSS still serves a narrow desktop window.

## Build and preview

```bash
node site/build.mjs
```

writes the site to `site/dist/` (git-ignored). Serve that folder with any
static server to look at it, for example:

```bash
python -m http.server 7951 --bind 127.0.0.1 --directory site/dist
```

## Deploying on Vercel

Import the repository and set **Root Directory** to `site`. Everything else
comes from `site/vercel.json`: no framework, no install step, the build
command and output folder, and the security headers. Vercel's build can read
files outside the root directory, which is how the screenshots get in.

**A push builds only when the site could have changed**: something under
`site/`, `docs/screenshots/` or `docs/social-preview.png` differs from the
last successful deployment (`ignoreCommand`; exit 0 skips, anything else
builds). With no previous
deployment, or one whose commit is not in Vercel's clone, the command fails
and the build runs, so it errs towards building. Any other folder the site
starts reading from must be added to that path list.

`?device=android` opens the chart gallery on the phone instead of the laptop.
