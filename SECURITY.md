# Security policy

## Reporting a vulnerability

Please report security issues **privately**, through GitHub's
**Security → Report a vulnerability** on this repository, not in a public
issue. Include what you found, how to reproduce it, and what an attacker could
do with it. You should hear back within a week.

Only the latest commit on `main` is supported; there are no maintained release
branches.

## What is in scope

This is a local tool, so the interesting boundaries are local ones:

- **The dashboard** (Next.js, port 7843). It serves a person's per-app usage
  history, behind a password. Anything that reads that history without the
  password, bypasses the login throttle, or lets another page act with a
  signed-in session is in scope. By default it listens on `127.0.0.1`; with
  `DASHBOARD_HOST` set it is reachable on the local network over plain HTTP,
  which is a documented trade-off, not a vulnerability in itself.
- **The privilege split.** Only `scripts/srum-snapshot.ps1` runs as
  Administrator, from `%ProgramData%\DataUsageTracker`. Any way for a
  non-administrator to make code of their choosing run in that task, or to
  steer its writes elsewhere, is in scope.
- **The phone ingest endpoint** (`/api/android/ingest`), authenticated by a
  bearer token.
- **The Android app**, which uploads to an address the user enters.

Out of scope: anything requiring an already-elevated attacker, physical access
to an unlocked machine, or a deliberately weakened configuration (a short
password is refused; a password shared with an attacker is not a bug).

## How it is built to be safe

See [docs/DESIGN.md, "Security model"](docs/DESIGN.md#security-model) and
["The privilege split"](docs/DESIGN.md#the-privilege-split).
