# Contributing

Thanks for looking. This is a personal tool shared as is, so the bar is: keep
it working for its one real use, and keep it honest about its numbers.

- **Bugs and questions:** open an issue. Please leave out your own usage data,
  device names and network names; describe the shape of the problem instead.
- **Small fixes:** a pull request is welcome.
- **Anything larger:** open an issue first, so we can agree it fits before you
  spend the time.
- **Security issues:** not in a public issue; see [SECURITY.md](SECURITY.md).

## Before sending a change

```bash
npm run typecheck
npm run selftest
npm run build
```

The self-test needs no admin rights and no real data. If you touch ingest,
the dedup key, or anything that sums bytes, read
[docs/DESIGN.md](docs/DESIGN.md) first: several of its rules look wrong until
you have seen the data that produced them.

## Conventions

- **Conventional commit messages** (`feat:`, `fix:`, `docs:`), one concern per
  commit.
- **Keep every `.ps1` pure ASCII.** Windows PowerShell 5.1 misreads a UTF-8
  dash in a BOM-less script, and silently changes its logic.
- **Never commit collected data.** `.gitignore` blocks databases, snapshots and
  CSVs; if you add a new collector output, add it there first.
- **Screenshots come from the demo data only.** If a change alters what a
  pictured page looks like, regenerate them with `npm run demo:data`,
  `npm run build` and `npm run demo:shots` rather than capturing your own
  dashboard, which would publish your usage.
- **Never make the collector task elevated.** Only the shadow copy is. See
  [docs/DESIGN.md](docs/DESIGN.md#the-privilege-split).
- **No new runtime dependencies without a reason.** The project is meant to
  build years from now from what is on disk; that is why it uses
  `node:sqlite` and why the Android app has no dependencies at all.
