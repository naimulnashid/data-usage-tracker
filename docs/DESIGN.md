# Design notes

The parts of this project you cannot infer from the code: how the data sources
behave, the traps that were found by measuring them, and why the security model
is shaped the way it is. The README covers setup and use.

Most of these rules exist because the obvious approach was tried first and gave
a wrong number that looked right.

- [The Windows collector](#the-windows-collector)
- [SRUM traps](#srum-traps)
- [Display names](#display-names)
- [The privilege split](#the-privilege-split)
- [The Android half](#the-android-half)
- [Days with no rows](#days-with-no-rows)
- [Security model](#security-model)
- [Running the dashboard](#running-the-dashboard)
- [PowerShell traps](#powershell-traps)

---

## The Windows collector

The source is SRUM (System Resource Usage Monitor), an ESE ("JET Blue") database
at `C:\Windows\System32\sru\SRUDB.dat`, the same store Windows' own Data usage
page reads. Per-app network rows are in the table
`{973F5D5C-1D90-4944-BE8E-24B94231A174}`. SRUM keeps roughly 30 to 60 days and
lives on the OS partition, so a reset erases it; this project copies it
somewhere that survives.

It is parsed with **SrumECmd** (Eric Zimmerman), deliberately and permanently.
A custom ESE parser would have to re-implement identity resolution through
`SruDbIdMapTable` and interface decoding, for no visible benefit and a real risk
of silently wrong numbers.

**Cadence is daily, on purpose.** SRUM writes hourly rows whatever the polling
rate, so the collector only has to run faster than *eviction*, not faster than
*writing*. Running hourly would copy the ~99 MB database 24 times a day for
identical data.

**The database must not live on `C:\`.** A reset wipes it, which is the failure
the project exists to prevent, so `openDatabase()` refuses such a path and only
the self-test (with a throwaway database in TEMP) may override it.

**Restore from the backup, not the live file.** In WAL mode a SQLite database is
three files that must agree, and a sync client can upload them mid-write. The
backup is written with `node:sqlite`'s `backup()`, so it is one consistent file.
Ingest also checkpoints the WAL first, which narrows but does not close the
window in which the live file is inconsistent.

`node:sqlite` rather than `better-sqlite3`: no native build step to break on a
clean install years from now, and it provides `backup()`.

### CSV columns (SrumECmd `*_NetworkUsages_Output.csv`)

```
Id, Timestamp, ExeInfo, ExeInfoDescription, ExeTimestamp, SidType, Sid,
UserName, UserId, AppId, BytesReceived, BytesSent, InterfaceLuid,
InterfaceType, L2ProfileFlags, L2ProfileId, ProfileName
```

- `SidType` is an enum that appears *before* `Sid` and `UserId`, so a regex
  column probe matching "Sid" grabs the wrong column. Match exact names.
- `InterfaceType` is already decoded (`IF_TYPE_IEEE80211`); store it as is.
- `ProfileName` is empty in practice, even when SrumECmd is given the SOFTWARE
  hive. Network names are observed instead; see below.
- Timestamps are UTC. `local_date` / `local_hour` are computed at ingest and
  stored, because grouping raw UTC into days shifts every daily total by the
  UTC offset. `timestamp_utc` stays the source of truth.

---

## SRUM traps

**1. The live file needs a shadow copy.** `SRUDB.dat` is in use while Windows
runs. It can be opened with a ReadWrite share mode, but a copy of a live ESE
database made that way can be torn mid-write, which is exactly what Volume
Shadow Copy prevents:

```
esentutl.exe /y C:\Windows\System32\sru\SRUDB.dat /vss /d <dest>\SRUDB.dat
```

That requires Administrator, and it is the only step that does.

**2. The shadow copy is always "Dirty Shutdown", and it must be recovered.**
SrumECmd does not parse a dirty database at all: ESE refuses to attach it, and
SrumECmd writes no CSV while still exiting 0. `scripts/srum-recover.ps1`
replays the journals:

```
esentutl.exe /r sru /i /l <scratch> /s <scratch> /d <scratch>
```

Each of these was learned from a failed run:

- **The rolled-over journals are readable without elevation; the current one,
  `SRU.log`, is often held by the SRUM service for several seconds**, and the
  snapshot itself seems to provoke the hold. Missing that one file is fatal,
  because it is the log recovery most needs. The journals are copied with
  `FileShare.ReadWrite|Delete` and retried.
- **`esentutl /r` exiting 0 does not mean the database is clean.** With the
  tail generation missing it replays what it has, leaves the database dirty,
  and still returns 0. Success is read back from the header with
  `esentutl /mh`, never from the exit code.
- **When replay falls short, `esentutl /p /o` repairs the copy**, and the
  copied journals must then be deleted: a repaired database next to a stale log
  stream makes SrumECmd attempt its own recovery and fail with "Current log
  file missing". Repair only ever touches the throwaway copy.
- **Copy the journals after the snapshot**, so they can only be newer than it,
  the direction recovery resolves.
- **The snapshot must be named `SRUDB.dat`**: the log stream records the
  database by name, and `/d` only redirects the directory.
- **Do not copy `SRU.chk`, `SRUtmp.log` or `SRUres*.jrs`.** The checkpoint can
  name a generation Windows already deleted; without it recovery starts from
  the oldest log present.

Recovery failure is logged, not thrown: a snapshot that happens to be clean
still parses, and the parse is the one place the run gives up.

**3. `AppId = 1` is not an app. It is the per-interface total.** SRUM writes one
row per hour with `AppId = 1` whose bytes equal the sum of every named app in
that hour. Summing all rows double-counts everything. So:

- headline totals come from `AppId = 1` rows (`is_aggregate = 1`);
- per-app figures come from every other row;
- **the two are never added together.** A total roughly double what Windows
  shows means this rule was broken.

The two agree to about 0.1%; the remainder is traffic from processes SRUM could
not attribute.

**4. `AppId` is an executable path, an AppX package family name, or a service
name**, and the non-path kinds are common. The schema stores `app_id` and
`app_kind`, not a column called `exe_path`. Paths arrive in NT form
(`\device\harddiskvolume4\...`), lowercased.

**5. The dedup key includes the network profile and the byte values:**

```
UNIQUE (timestamp_utc, app_id, user_id, interface_luid, l2_profile_id,
        bytes_sent, bytes_received)
```

`L2ProfileId` distinguishes networks, so one app in one hour on one adapter can
legitimately have several rows. And SRUM writes extra rows at sleep and shutdown,
off the hourly cadence, which can share every other field while carrying
different bytes; both are real. Re-ingesting overlapping data produces
byte-identical rows, which `INSERT OR IGNORE` skips, so ingest stays idempotent.

**6. Do not dedup on SRUM's own row id.** It is unique within one SRUM database,
and Windows renumbers from scratch when it rebuilds that database, which is the
event this project exists to survive.

**7. An unscoped total will not match Windows.** Windows' Data usage page is
scoped to one network profile; the dashboard defaults to all of them. That is
why it has a network selector and why its "All networks" figure is labelled.

### Network names are observed, not read

SRUM stores `L2ProfileId` and nothing human-readable. So the collector, and a
15-minute "Network Watch" task, record which network the machine is connected
to (`Get-NetConnectionProfile`), and a later ingest attributes that name to a
profile id **only once the hour it falls in is present in SRUM and exactly one
profile has rows in that hour**. Pairing "the network I am on now" with "the
profile of the newest row" named profiles after networks they never carried,
because SRUM's newest row is routinely more than an hour old.

One profile id can carry several SSIDs (a router's 2.4 and 5 GHz networks), so
names are stored as votes per (profile, name), and the display shows the
most-seen one.

---

## Display names

Windows' own list is not raw SRUM strings, and reproducing it takes two stages
in `src/lib/app-name.ts`:

| Stage | Produces | Example |
|---|---|---|
| identity -> **member** | one per distinct program | `claude.exe` -> Claude Code |
| member -> **family** | one per product | Claude Code + Claude desktop -> Claude |

Everything the dashboard groups, charts and links on is the family; an app's
detail page lists its members, so no merge is silent.

- NT paths reduce to the basename; versioned install directories and AppX
  version strings are stripped, so one app does not split into many.
- Service names are grouped and relabelled as Windows does (`DoSvc` + `BITS` is
  "System and Windows Update").
- **A family's display name must be unique**: colours and logos are keyed by it.
- **A path-vendor rule applies even when the basename is known**, or an app and
  its installer become two families with the same name.
- **Generic basenames are keyed by directory.** `setup.exe` is several unrelated
  installers.
- Names are resolved in code, never stored, so a fix needs no re-ingest.

A detail page exists only for an app with a shape to show:
`total >= 250 MB OR (active days >= 7 AND total >= 10 MB)`, judged on the
family, and re-checked by the page itself so a pasted link cannot render a page
of one bar.

---

## The privilege split

Only `scripts/srum-snapshot.ps1` runs as Administrator, and only from a copy in
`%ProgramData%\DataUsageTracker\bin` that `register-task.ps1` deploys.
Everything else runs as the user.

| Task | Runs | Elevated | Trigger |
|---|---|---|---|
| Data Usage Collector | `scripts\collector.ps1` from the repo | No | daily, and the dashboard's Sync button |
| Data Usage Snapshot | the deployed `srum-snapshot.ps1` | Yes | on demand, by the collector |

The collector used to run elevated and execute files the user can edit (the
repo, `node_modules`, the SrumECmd folder), while any process running as the
user could start it. That is a path from user to Administrator with no prompt.

The flow now:

1. The collector starts the snapshot task (`schtasks /run`).
2. The task VSS-copies `SRUDB.dat` into `%ProgramData%\DataUsageTracker\work`
   and writes `status.json`.
3. The collector waits for a status newer than its request, copies the
   snapshot into its own scratch folder, and replays, parses, ingests and backs
   up there, unelevated. The journals are readable without elevation, which is
   why replay could stay on this side.

What keeps it safe:

- The deploy directory is created **with** its security descriptor in one call
  (SYSTEM and Administrators full, the registering user read-only, inheritance
  off). `%ProgramData%` lets ordinary users create files in subfolders, so
  "create, then lock down" leaves a gap.
- `srum-snapshot.ps1` re-checks that directory every run
  (`Test-AdminOnlyWrite` in `protected-dir.ps1`) and writes nothing, not even
  its status, into a directory others can write: a planted link there would
  turn an Administrator's write into one somewhere else.
- It reads no config. Its one input, the SRUM path, is baked into the task at
  registration, which an administrator approves.
- It clears its work folder with `rd /s /q`, which removes a junction rather
  than following it.
- The collector refuses to clear a scratch folder that is a drive root,
  contains the database or a system folder, or holds files it did not write.
- **After editing `srum-snapshot.ps1` or `protected-dir.ps1`, re-run
  `register-task.ps1`.** The task runs the deployed copy; the collector logs a
  warning when it has drifted from the repo.

---

## The Android half

The phone reports through an app in `android/` that reads
`NetworkStatsManager` on the device, **not** through `adb` and `dumpsys`. A VPN
network is reported under both its own transport and the one beneath it, so the
raw dump double-counts every byte that crossed a VPN; the public API resolves
that.

- **Tethering (uid `-5`) is traffic the phone relayed for other devices.** If a
  laptop that runs this dashboard tethers off the phone, those bytes are in
  both devices' records. It is stored, labelled and kept out of totals.
  **Never add a phone's total to the laptop's.**
- **A uid is not an app.** Several packages can share one uid, and cloned apps
  live under other user profiles. The phone sends uid -> package -> label,
  because only `PackageManager` can answer that.
- **The dedup rule is inverted from Windows.** A NetworkStats bucket is a
  running total: read at 10:30 and again at 11:30, the same bucket grows. Bytes
  are *not* in the key, and the write is an upsert taking `MAX()`, so a late,
  stale reading can never shrink a bucket. The app re-reads one bucket before
  its watermark each sync, and advances the watermark only from what the server
  confirmed.
- **Retention is about 90 days**, so a sync every six hours on unmetered
  networks is plenty.
- **Usage access is an app-op, not a runtime permission.**
  `checkSelfPermission` reports it granted regardless; only
  `AppOpsManager` tells the truth. Without it the app silently reports only
  its own traffic.
- **Below API 29, a null subscriber id reads zero mobile traffic**, not all of
  it. So older phones query each SIM's IMSI (needing `READ_PHONE_STATE`,
  requested only there), and a sync refuses to run without it rather than
  advancing past mobile data it never read.
- `querySummary`, never `queryDetails`, which mixes tagged and untagged rows and
  double-counts.
- The app has no dependencies (JobScheduler, `HttpURLConnection`, views in
  code), so it builds from what is on disk.
- Cleartext HTTP is allowed broadly in the network security config because
  Android cannot express "private ranges"; `Uploader.assertPrivateIfCleartext`
  refuses to send over HTTP to anything but a private address, and redirects
  are not followed.

### Per-network phone traffic needs a cable

Android records per-app traffic per SSID but does not expose it to apps. So
`npm run android:ssid` reads it over USB from `dumpsys netstats --full detail`.
**Both flags matter**: without `--full` the history silently stops at the last
reboot. Only Wi-Fi rows carry an SSID, and VPN traffic is reported on a stacked
network with none, so filtering on "has an SSID" excludes the VPN double-count.
The two sources agree to a fraction of a percent. Every SSID figure is clamped to
the window the capture actually covers, per device.

---

## Days with no rows

Queries return rows only for days that have them, and the charts use a category
axis, so a line drawn across a gap looked like steady growth over days that had
no data. `src/lib/days.ts` fills every daily series to one entry per day:

- **inside collected history**, an empty day is 0: the device was idle or off;
- **outside it**, it is null: nothing was collected, and the chart draws a
  break and the tooltip says so.

On Windows, "collected history" is the union of successful runs' SRUM windows;
on Android, first to last day with a row. Anything "per active day" (spike
thresholds, detail-page eligibility) counts real rows, never filled ones.

---

## Security model

The dashboard shows which programs run on a machine and when, so it is treated
as sensitive even on a home network.

- **It listens on `127.0.0.1` by default.** `next start` takes the address only
  as a `-H` flag, so `npm start` goes through `scripts/run-next.mjs`, which
  reads `DASHBOARD_HOST`. `0.0.0.0` opens it to the LAN, which the phone needs.
- **Every route is behind `src/middleware.ts`**, so a new route cannot forget
  to protect itself. It fails closed: an unset password, or one under 12
  characters, locks the dashboard rather than opening it.
- **The session cookie** is `<expiry>.<HMAC-SHA256(expiry)>`, keyed by a
  PBKDF2-derived key from the password. So rotating the password signs everyone
  out, and a sniffed cookie is not a fast way to test guesses. It is not
  `secure` (the site is plain HTTP), and `/login` stays outside the
  dashboard's route group, whose layout queries the database.
- **Wrong passwords are throttled globally** (10 a minute, then a lock that
  doubles). Per-client limits are impossible here: the only client identity a
  route sees is `X-Forwarded-For`, which `next start` passes through from the
  client.
- **State-changing API calls must be same-origin** (`Sec-Fetch-Site`, then
  `Origin`). `SameSite=Lax` alone does not cover it, because a "site" ignores
  the port, so any other `localhost` page counts as same-site. `Origin` is
  compared with the `Host` header, never with `request.nextUrl.origin`: under
  `next start -H` Next builds that from the bind address (`127.0.0.1`,
  `0.0.0.0`), which no browser sends, and 3.0.0 refused every sign-in that way.
- **`?next=` after login is resolved and must stay on this origin**; a plain
  "starts with `/`" check lets `/\example.com` through.
- **Headers:** a CSP limiting every target to `'self'` (scripts keep
  `'unsafe-inline'` for Next's inline payload), no framing, `nosniff`,
  `no-referrer`, and no `X-Powered-By`. SVG logos get a `sandbox` policy.
- **The phone authenticates with `ANDROID_INGEST_TOKEN`**, a bearer token
  separate from the password, so the dashboard password never lives on a
  device that leaves the house. The ingest endpoint caps the body while reading
  and validates every field.
- **No telemetry.** `run-next.mjs` sets `NEXT_TELEMETRY_DISABLED` for every Next
  command, and the image optimiser is switched off because nothing uses it.

---

## Running the dashboard

- **Build after every change it serves.** `next start` serves the bundle it
  read at boot; nothing watches `src/`. The logon launcher builds only when
  there is no build at all (`ensure-build.ps1`), and logs a warning when the
  build is older than the source.
- **`dashboard-stop.ps1` stops this dashboard, not whatever holds the port.**
  A listener counts as this dashboard only when its command line runs Next from
  this repo's own `node_modules\`; other local Node servers are left alone.
- **Logos are served by a route**, not from `public/`, because `next start`
  snapshots `public/` at boot. See `public/apps_logo/README.md`.
- **Loading skeletons mirror each page's sections at measured heights**, so
  nothing moves when data arrives; they reuse the real card and grid classes
  so spacing cannot drift.

---

## PowerShell traps

- **Keep every `.ps1` pure ASCII.** Windows PowerShell 5.1 reads a BOM-less
  script as ANSI, so a UTF-8 em-dash becomes a character PowerShell treats as a
  string delimiter. It silently changes logic with no error. `npm run drill`
  checks it.
- **`& native.exe 2>&1` throws on the first stderr line** under
  `$ErrorActionPreference = 'Stop'` in 5.1. Use the collector's
  `Invoke-Native` for any native call whose stderr you expect.
- **`Set-Content -Encoding utf8` writes a BOM in 5.1**, which `JSON.parse`
  rejects. Write JSON with `UTF8Encoding($false)`.
- **Exported task XML must stay UTF-16 LE**, as its own declaration says, or
  `schtasks /create /xml` rejects it. After a reset, re-run `register-task.ps1`
  rather than importing the XML: the XML embeds the old install's SID, and the
  snapshot task needs its script redeployed.
- **A repeating trigger must not use `-RepetitionDuration [TimeSpan]::MaxValue`**,
  which serialises out of range and silently fails to register; omit the
  duration for "forever".
