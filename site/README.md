# Project site

A one-page site that shows what this project is and does, for people who
find the repository: the problem it solves, how the collectors work, the
dashboard's pages, every chart it draws, and every feature.

Plain HTML, CSS and one script, with no framework and no dependencies. The
charts are drawn in the browser from a fixed random seed, so they are the
same on every load and are nobody's usage. The dashboard screenshots come
from `docs/screenshots/`, which `npm run demo:shots` regenerates in both
themes from one history; the page shows the set matching its own theme, and
the build copies them in rather than keeping a second set here.

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
`site/` or `docs/screenshots/` differs from the last successful deployment
(`ignoreCommand`; exit 0 skips, anything else builds). With no previous
deployment, or one whose commit is not in Vercel's clone, the command fails
and the build runs, so it errs towards building. Any other folder the site
starts reading from must be added to that path list.

`?device=android` opens the chart gallery on the phone instead of the laptop.
