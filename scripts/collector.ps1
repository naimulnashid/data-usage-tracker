<#
    The collector. Runs daily from Task Scheduler, NOT elevated.

        request snapshot -> parse -> ingest -> backup -> clean up

    Only the snapshot needs Administrator (esentutl /vss), and since 2026-09-21
    this script does not take it. It starts the "Data Usage Snapshot" task,
    which runs srum-snapshot.ps1 elevated from an admin-owned copy, waits for
    its status.json, and copies the recovered snapshot into scratch. Everything
    after that -- SrumECmd, node, the database -- runs as the user. See the
    header of srum-snapshot.ps1 for why the split exists.

    So this runs fine from a normal PowerShell, and the dashboard's Sync button
    starts it without elevating anything.

    Cadence is DAILY by design. SRUM writes hourly rows and retains 30+ days, so
    the collector only has to run faster than eviction, not faster than writing.
    Running hourly would VSS-copy ~99 MB twenty-four times a day for
    byte-identical data. See docs/DESIGN.md.

    Safe to run twice: ingest is idempotent, so a second pass over the same
    window inserts zero rows.
#>

[CmdletBinding()]
param(
    # Resolved in the body, NOT as a default here. $PSScriptRoot is empty while
    # param() defaults are evaluated under `powershell -File`, which silently
    # produced "\..\config\collector.json" and a confusing not-found error.
    [string]$ConfigPath,
    [switch]$KeepScratch,
    [switch]$SkipBackup,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date

# Locate the script directory defensively. $PSScriptRoot is reliable in the body
# but empty when dot-sourced in some hosts, and getting this wrong would resolve
# $root to C:\ and scatter logs into C:\logs.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot }
             elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path }
             else { $null }

if (-not $scriptDir) {
    Write-Host "Cannot determine script location. Run this by full path:" -ForegroundColor Red
    Write-Host "  powershell -ExecutionPolicy Bypass -File <repo>\scripts\collector.ps1" -ForegroundColor Yellow
    exit 1
}

$root = (Resolve-Path (Join-Path $scriptDir '..')).Path

# Sanity-check that $root really is the repo, so a bad resolution fails loudly
# here instead of creating directories in surprising places.
if (-not (Test-Path (Join-Path $root 'scripts\collector.ps1'))) {
    Write-Host "Resolved project root looks wrong: $root" -ForegroundColor Red
    exit 1
}

if (-not $ConfigPath) { $ConfigPath = Join-Path $root 'config\collector.json' }

$logDir  = Join-Path $root 'logs'
$logFile = Join-Path $logDir ("collector-{0}.log" -f $startedAt.ToString('yyyy-MM-dd'))
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -Path $logFile -Value $line -Encoding utf8
    if (-not $Quiet) {
        $color = switch ($Level) { 'ERROR' { 'Red' } 'WARN' { 'Yellow' } 'OK' { 'Green' } default { 'Gray' } }
        Write-Host $line -ForegroundColor $color
    }
}

# Locate node explicitly. Task Scheduler can run with a PATH that does not
# include it, so relying on the bare command name works interactively and then
# fails silently at 03:00.
function Resolve-Node {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($guess in @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        "$env:APPDATA\npm\node.exe"
    )) { if (Test-Path $guess) { return $guess } }
    return $null
}

# Best-effort: write a failed run into sync_log so the dashboard shows the
# breakage instead of a stale success.
function Record-Failure {
    param([string]$Message)
    try {
        if ($script:nodeExe -and (Test-Path $script:ingestScript)) {
            & $script:nodeExe --import tsx $script:ingestScript `
                --record-failure $Message 2>&1 | Out-Null
        }
    } catch {
        Write-Log "could not record failure in sync_log: $($_.Exception.Message)" 'WARN'
    }
}

$script:nodeExe = $null
$script:ingestScript = Join-Path $root 'scripts\ingest.ts'

# The elevated half. register-task.ps1 creates the task and deploys the
# scripts it runs; these names must match what it uses.
$snapshotTask = 'Data Usage Snapshot'
$deployRoot   = Join-Path $env:ProgramData 'DataUsageTracker'
$snapWorkDir  = Join-Path $deployRoot 'work'
$snapStatus   = Join-Path $deployRoot 'status.json'

# Soft recovery for the snapshot. Not optional -- SrumECmd refuses a dirty
# database outright. Runs unelevated, here, in scratch. See srum-recover.ps1.
. (Join-Path $scriptDir 'srum-recover.ps1')

# Dropped into scratch when it is created. Clearing scratch deletes a whole
# directory named in a config file, so it has to be sure the directory is its
# own -- see Assert-SafeScratch.
$scratchMarker = '.data-usage-scratch'

<#
    Refuse to clear a scratch directory that is not plainly ours.

    Scratch is wiped at the start of every run and again at the end, and its
    path comes from config/collector.json. A typo there -- `D:\` for
    `D:\DataUsage-scratch`, or the persistent folder itself -- would otherwise
    recursively delete it, and until 2026-09-21 that delete ran as
    Administrator. Now it runs as the user, which bounds the damage but does
    not remove it: the user can delete their own database.
#>
function Assert-SafeScratch {
    param([string]$Dir, [string[]]$Protected)

    $full = [System.IO.Path]::GetFullPath($Dir).TrimEnd('\')
    if ([System.IO.Path]::GetPathRoot($full).TrimEnd('\') -eq $full) {
        throw "scratchDir '$Dir' is a drive root; refusing to clear it."
    }
    foreach ($p in $Protected) {
        if (-not $p) { continue }
        $pf = [System.IO.Path]::GetFullPath($p).TrimEnd('\')
        if ($pf -eq $full -or $pf.StartsWith("$full\", [StringComparison]::OrdinalIgnoreCase)) {
            throw "scratchDir '$Dir' contains $p; refusing to clear it."
        }
    }
    if (-not (Test-Path -LiteralPath $full)) { return }

    $item = Get-Item -LiteralPath $full -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "scratchDir '$Dir' is a link; refusing to clear it."
    }
    if (Test-Path -LiteralPath (Join-Path $full $scratchMarker)) { return }

    # Scratch from before the marker existed: a failed run leaves its scratch
    # behind as evidence, without one. Accept a directory holding nothing but
    # what the collector has ever written there.
    $known = '^(SRUDB\.dat|SRU.*\.log|sru\.chk|srures\d+\.jrs|.*\.INTEG\.RAW|network\.json|csv)$'
    $strangers = @(Get-ChildItem -LiteralPath $full -Force | Where-Object { $_.Name -notmatch $known })
    if ($strangers.Count -gt 0) {
        $names = ($strangers | Select-Object -First 3 | ForEach-Object { $_.Name }) -join ', '
        throw "scratchDir '$Dir' holds files the collector did not put there ($names); refusing to clear it. Point scratchDir at a new or empty directory."
    }
}

# status.json from the snapshot task, or $null. Opened sharing read, write and
# delete, so this never blocks the task swapping in a fresh one.
function Read-SnapshotStatus {
    if (-not (Test-Path -LiteralPath $snapStatus)) { return $null }
    try {
        $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
        $fs = [System.IO.File]::Open($snapStatus, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
        try {
            $reader = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
            return $reader.ReadToEnd() | ConvertFrom-Json
        } finally { $fs.Dispose() }
    } catch { return $null }
}

# Run a native program and return its exit code and output, never throwing.
#
# Under $ErrorActionPreference = 'Stop', Windows PowerShell 5.1 turns the
# first line a native program writes to stderr into a TERMINATING error when
# it is redirected with 2>&1. schtasks reports "task not found" on stderr, so
# the friendly message after the call never ran and the run failed with
# schtasks' own "The system cannot find the file specified." Found by testing
# the split on 2026-09-21.
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = @(& $Exe @Arguments 2>&1 | ForEach-Object { "$_" }) }
    finally { $ErrorActionPreference = $prev }
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $out }
}

# ConvertFrom-Json in Windows PowerShell 5.1 leaves ISO dates as strings;
# PowerShell 7 hands back a DateTime. Take either, or a run started by hand in
# pwsh would compare local time against UTC and never see its snapshot.
function ConvertFrom-IsoUtc {
    param($Value)
    if (-not $Value) { return $null }
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime() }
    return [DateTime]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture,
                             [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}

Write-Log "=== collector run started ==="

try {
    # -----------------------------------------------------------------------
    # Preflight
    # -----------------------------------------------------------------------
    if (-not (Test-Path $ConfigPath)) { throw "Config not found: $ConfigPath" }
    $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json

    $dbPath     = $cfg.databasePath
    $scratchDir = $cfg.scratchDir
    $keep       = $KeepScratch -or $cfg.keepScratch

    # The one rule the project exists to enforce. Also checked in db.ts; a
    # database on C:\ dies in the reset this tool is meant to survive.
    if ($dbPath -like "$env:SystemDrive\*") {
        throw "databasePath is on the system drive ($dbPath). It would be lost in a Windows reset."
    }

    $script:nodeExe = Resolve-Node
    if (-not $script:nodeExe) { throw "node.exe not found. Install Node 22+ or add it to PATH." }
    Write-Log "node: $script:nodeExe"

    # SrumECmd
    $srumECmd = $null
    if ($cfg.srumECmdDir -and (Test-Path (Join-Path $cfg.srumECmdDir 'SrumECmd.exe'))) {
        $srumECmd = Join-Path $cfg.srumECmdDir 'SrumECmd.exe'
    } else {
        $onPath = Get-Command SrumECmd.exe -ErrorAction SilentlyContinue
        if ($onPath) { $srumECmd = $onPath.Source }
    }
    if (-not $srumECmd) {
        throw "SrumECmd.exe not found. Set srumECmdDir in $ConfigPath (download from https://ericzimmerman.github.io/)."
    }
    Write-Log "SrumECmd: $srumECmd"

    # Scratch. Holds a full copy of the usage history mid-run, so it lives on
    # the persistent drive rather than a synced folder, and is wiped afterwards.
    Assert-SafeScratch -Dir $scratchDir -Protected @(
        $dbPath, $cfg.backupPath, $root, $env:USERPROFILE, $env:SystemRoot,
        $env:ProgramFiles, $env:ProgramData)
    if (Test-Path -LiteralPath $scratchDir) { Remove-Item -LiteralPath $scratchDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $scratchDir | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $scratchDir $scratchMarker),
        "Scratch for scripts\collector.ps1. Safe to delete; it is cleared every run.`r`n")
    # Named SRUDB.dat, not something more descriptive: soft recovery looks the
    # database up by the name recorded in the log stream. See srum-recover.ps1.
    $snapshot = Join-Path $scratchDir 'SRUDB.dat'
    $csvOut   = Join-Path $scratchDir 'csv'

    # -----------------------------------------------------------------------
    # 1. VSS snapshot, by the elevated task
    # -----------------------------------------------------------------------
    # schtasks rather than Get-ScheduledTask: this runs in a non-interactive
    # S4U session, and the plain exe is what the dashboard already relies on
    # there. A CIM hiccup must not read as "the task does not exist".
    if ((Invoke-Native schtasks.exe @('/query', '/tn', $snapshotTask)).ExitCode -ne 0) {
        throw "The '$snapshotTask' task is not registered, so nothing can take the SRUM snapshot. Run scripts\register-task.ps1 once from an Administrator PowerShell."
    }

    # A deployed copy that no longer matches the repo means a fix to the
    # elevated scripts has not reached the task. Worth a warning, not a stop:
    # the deployed copy is still the vetted one.
    foreach ($name in @('srum-snapshot.ps1', 'protected-dir.ps1')) {
        $deployed = Join-Path $deployRoot "bin\$name"
        $inRepo   = Join-Path $scriptDir $name
        if (-not (Test-Path -LiteralPath $deployed)) {
            Write-Log "deployed $name is missing; re-run scripts\register-task.ps1 as Administrator" 'WARN'
        } elseif ((Get-FileHash -LiteralPath $deployed).Hash -ne (Get-FileHash -LiteralPath $inRepo).Hash) {
            Write-Log "deployed $name differs from the repo; re-run scripts\register-task.ps1 as Administrator to deploy it" 'WARN'
        }
    }

    Write-Log "requesting a snapshot from '$snapshotTask'"
    $requested = [DateTime]::UtcNow.AddSeconds(-2)
    $run = Invoke-Native schtasks.exe @('/run', '/tn', $snapshotTask)
    if ($run.ExitCode -ne 0) { throw "could not start '$snapshotTask': $($run.Output -join ' ')" }

    # Wait for a status written by THIS run: a stale status.json from an
    # earlier one has an older startedAt. The task normally takes a few
    # seconds; ten minutes is a ceiling, not an estimate.
    $snap = $null
    $idleSince = $null
    $deadline = (Get-Date).AddMinutes(10)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 1000
        $s = Read-SnapshotStatus
        if ($s -and $s.finishedAt -and (ConvertFrom-IsoUtc $s.startedAt) -ge $requested) { $snap = $s; break }

        # A task that ran and stopped without writing a status never will.
        # Say so, with its exit code, rather than waiting out the clock. Best
        # effort: if the task cannot be queried, the deadline still ends this.
        try {
            $task = Get-ScheduledTask -TaskName $snapshotTask -ErrorAction Stop
            $info = $task | Get-ScheduledTaskInfo -ErrorAction Stop
        } catch { $task = $null; $info = $null }
        $ranSince = $info -and $info.LastRunTime -and $info.LastRunTime.ToUniversalTime() -ge $requested
        if ($ranSince -and $task.State -ne 'Running') {
            if (-not $idleSince) { $idleSince = Get-Date }
            elseif (((Get-Date) - $idleSince).TotalSeconds -gt 10) {
                throw "'$snapshotTask' finished (result $($info.LastTaskResult)) without reporting a status. Check that %ProgramData%\DataUsageTracker is intact, or re-run scripts\register-task.ps1."
            }
        }
    }
    if (-not $snap) { throw "'$snapshotTask' did not report within 10 minutes." }
    if (-not $snap.ok) { throw "snapshot failed: $($snap.error)" }

    $taken = Join-Path $snapWorkDir 'SRUDB.dat'
    if (-not (Test-Path -LiteralPath $taken)) { throw "the snapshot task reported success but $taken is missing" }
    Copy-Item -LiteralPath $taken -Destination $snapshot -Force
    Write-Log "snapshot ok: $($snap.snapshotMB) MB in $($snap.snapshotSeconds)s (elevated task)" 'OK'

    # -----------------------------------------------------------------------
    # 1b. Soft recovery -- unelevated, in scratch, exactly as before the split
    # -----------------------------------------------------------------------
    #
    # The copy is in 'Dirty Shutdown' state, and SrumECmd will not attach a
    # dirty database at all -- it throws rather than parsing what it can. So
    # this step is load-bearing, not a tidy-up. Three runs failed with
    # "produced no NetworkUsage CSV" on 2026-08-27 before it existed.
    #
    # The journals are copied now, after the snapshot, so they can only be
    # newer than it -- the direction soft recovery resolves. They are readable
    # without elevation, which is why this half did not need to move.
    #
    # A failure here is logged rather than thrown: if the snapshot happens to
    # be clean already the parse below still succeeds, and its error message is
    # the more useful place to give up.
    #
    # Ok reports the database header's state, NOT esentutl's exit code. Replay
    # returns 0 while leaving the database dirty when the tail generation is
    # missing, which is how the 2026-09-06 and 2026-09-08 runs logged a
    # successful recovery and then produced no CSV. See srum-recover.ps1.
    $srumDir = Split-Path -Parent $(if ($cfg.srumPath) { $cfg.srumPath } else { Join-Path $env:SystemRoot 'System32\sru\SRUDB.dat' })
    $rec = Invoke-SrumSoftRecovery -WorkDir $scratchDir -SrumDir $srumDir
    $rec.Warnings | ForEach-Object { Write-Log $_ 'WARN' }
    if ($rec.Ok -and $rec.Repaired) {
        Write-Log "replay fell short; hard repair cleaned the snapshot ($($rec.LogsCopied) journals copied)" 'WARN'
    } elseif ($rec.Ok) {
        Write-Log "soft recovery ok ($($rec.LogsCopied) journals replayed, database is clean)" 'OK'
    } else {
        Write-Log "recovery failed (state '$($rec.State)', exit $($rec.ExitCode), $($rec.LogsCopied) journals): $(($rec.Output | Select-Object -Last 3) -join '; ')" 'WARN'
    }

    # -----------------------------------------------------------------------
    # 1c. Which network are we on right now?
    # -----------------------------------------------------------------------
    #
    # The only reliable way to name a network. SRUM records L2ProfileId and
    # nothing else; its ProfileName column is empty and stays empty even when
    # SrumECmd is given the SOFTWARE hive. So instead of trying to resolve the
    # id, record what the machine is connected to at this moment and let ingest
    # pair it with whichever profile id owns the newest rows.
    #
    # Get-NetConnectionProfile rather than netsh: it needs no elevation, and it
    # covers Ethernet as well as Wi-Fi.
    $netJson = Join-Path $scratchDir 'network.json'
    try {
        $conns = @(Get-NetConnectionProfile -ErrorAction Stop | ForEach-Object {
            [pscustomobject]@{ name = $_.Name; interface = $_.InterfaceAlias }
        })
        @{ observedAt = (Get-Date).ToUniversalTime().ToString('o'); connections = $conns } |
            ConvertTo-Json -Depth 4 |
            ForEach-Object { [System.IO.File]::WriteAllText($netJson, $_, [System.Text.UTF8Encoding]::new($false)) }
        if ($conns.Count -gt 0) {
            Write-Log "connected to: $(($conns | ForEach-Object { $_.name }) -join ', ')" 'OK'
        } else {
            Write-Log "no active network connection to record" 'WARN'
        }
    } catch {
        Write-Log "could not read connection profile: $($_.Exception.Message)" 'WARN'
    }

    # -----------------------------------------------------------------------
    # 2. Parse
    # -----------------------------------------------------------------------
    New-Item -ItemType Directory -Force -Path $csvOut | Out-Null
    Write-Log "parsing with SrumECmd"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    # No -r here. SrumECmd accepts a SOFTWARE hive and calls it "recommended",
    # but it does NOT populate ProfileName for NetworkUsages -- tried it against
    # a real 117 MB hive on 2026-08-21 and every row still came back blank. The
    # step cost a 117 MB write to scratch per run for nothing, so it is gone.
    # Network names come from the observation in step 1c instead.
    $parseOut = & $srumECmd -f $snapshot --csv $csvOut 2>&1
    $parseExit = $LASTEXITCODE
    $sw.Stop()

    $netCsv = Get-ChildItem $csvOut -Filter '*NetworkUsage*.csv' -Recurse -ErrorAction SilentlyContinue |
              Sort-Object Length -Descending | Select-Object -First 1
    if (-not $netCsv) {
        throw "SrumECmd produced no NetworkUsage CSV (exit $parseExit; database state '$($rec.State)', repaired=$($rec.Repaired), $($rec.LogsCopied) journals copied, $($rec.JournalsMissed) missed): $($parseOut | Select-Object -Last 5)"
    }
    Write-Log "parsed in $([math]::Round($sw.Elapsed.TotalSeconds,1))s -> $($netCsv.Name)" 'OK'

    # -----------------------------------------------------------------------
    # 3. Ingest (writes its own sync_log row, and backs up on success)
    # -----------------------------------------------------------------------
    Write-Log "ingesting into $dbPath"
    $ingestArgs = @('--import', 'tsx', $script:ingestScript, '--csv', $csvOut)
    if ($SkipBackup) { $ingestArgs += '--no-backup' }

    Push-Location $root
    try {
        $ingestOut = & $script:nodeExe @ingestArgs 2>&1
        $ingestExit = $LASTEXITCODE
    } finally { Pop-Location }

    $ingestOut | ForEach-Object { Write-Log "  $_" }
    if ($ingestExit -ne 0) { throw "ingest failed (exit $ingestExit)" }
    Write-Log "ingest ok" 'OK'

    # -----------------------------------------------------------------------
    # 4. Clean up
    # -----------------------------------------------------------------------
    if ($keep) {
        Write-Log "scratch kept at $scratchDir (contains real usage data)" 'WARN'
    } else {
        Remove-Item $scratchDir -Recurse -Force
        Write-Log "scratch removed"
    }

    $elapsed = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
    Write-Log "=== run complete in ${elapsed}s ===" 'OK'
    exit 0
}
catch {
    $msg = $_.Exception.Message
    Write-Log $msg 'ERROR'
    Record-Failure $msg

    # Leave scratch in place on failure -- it is the evidence.
    Write-Log "=== run FAILED ===" 'ERROR'
    exit 1
}
