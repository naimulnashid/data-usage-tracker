<#
    The only code in this project that runs as Administrator. It does one thing:

        esentutl /y SRUDB.dat /vss  ->  %ProgramData%\DataUsageTracker\work

    It is run by the "Data Usage Snapshot" scheduled task, from a copy that
    register-task.ps1 places in %ProgramData%\DataUsageTracker\bin -- NOT from
    the repo. That placement is the point of the file.

    WHY THIS IS SEPARATE
    --------------------

    Until 2026-09-21 the whole collector ran elevated: collector.ps1 from the
    repo, SrumECmd from C:\Tools, and `node --import tsx scripts/ingest.ts`,
    which loads node_modules and src/lib. Every one of those is writable
    without elevation -- the repo and node_modules by this user, C:\Tools by
    ANY authenticated user -- and the task can be started without elevation;
    the dashboard's Sync button does exactly that. So any code running as the
    user could edit one file and get Administrator, with no UAC prompt.

    Only the VSS copy needs Administrator: SRUDB.dat is in use while Windows
    runs, and a consistent copy of it has to come from a shadow copy. The
    journal replay that follows does NOT: the journals are readable unelevated
    (verified 2026-09-21, the live SRU.log included), and the replay only
    touches the copy. So replay, parse and ingest all run as the user, in the
    same scratch directory as before -- recovery and parse still see the same
    directory layout they were debugged against.

    What this script touches, and nothing else:
      - reads    the live SRUM database (a system path)
      - writes   %ProgramData%\DataUsageTracker\work and status.json, which only
                 Administrators can write and the registering user can read
      - runs     esentutl.exe and cmd.exe from System32
    It reads no config file, loads nothing outside its own directory, and
    refuses to run if that directory is writable by anyone but Administrators.

    Pure ASCII, like every .ps1 here. See docs/DESIGN.md, "PowerShell traps".
#>

[CmdletBinding()]
param(
    # The live database. The default is where Windows keeps it. register-task
    # passes config/collector.json's srumPath here if that differs; this script
    # never reads the config itself, because the repo is writable without
    # elevation and this runs with it.
    [string]$SrumPath = (Join-Path $env:SystemRoot 'System32\sru\SRUDB.dat')
)

$ErrorActionPreference = 'Stop'

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot }
             elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path }
             else { $null }
if (-not $scriptDir) { exit 2 }

$deployRoot = Split-Path -Parent $scriptDir
$workDir    = Join-Path $deployRoot 'work'
$statusPath = Join-Path $deployRoot 'status.json'

$status = [ordered]@{
    ok              = $false
    startedAt       = [DateTime]::UtcNow.ToString('o')
    finishedAt      = $null
    snapshotMB      = $null
    snapshotSeconds = $null
    error           = $null
}

# Set once the deploy directory has passed Test-AdminOnlyWrite. Until then
# NOTHING is written there: a directory other users can write is exactly where
# a planted link would turn this script's write into one somewhere else, made
# as Administrator. The collector notices the missing status and reports the
# task's exit code instead.
$rootTrusted = $false

# Written to a temp name and moved into place, so the collector polling this
# file never reads half of it. Retried because the collector may be reading
# the old file at the instant it is replaced.
function Write-Status {
    if (-not $rootTrusted) { return }
    $status.finishedAt = [DateTime]::UtcNow.ToString('o')
    $json = [pscustomobject]$status | ConvertTo-Json
    $tmp = "$statusPath.tmp"
    [System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
    for ($i = 1; $i -le 10; $i++) {
        try { Move-Item -LiteralPath $tmp -Destination $statusPath -Force; return }
        catch { if ($i -eq 10) { throw }; Start-Sleep -Milliseconds 200 }
    }
}

try {
    . (Join-Path $scriptDir 'protected-dir.ps1')

    $isAdmin = ([Security.Principal.WindowsPrincipal] `
        [Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw 'Not elevated. esentutl /vss requires Administrator.' }

    # The safety of everything below rests on these two directories being
    # writable by administrators only. Checked every run, not just at deploy:
    # an ACL loosened later must stop the task, not be trusted.
    foreach ($dir in @($deployRoot, $scriptDir)) {
        if (-not (Test-AdminOnlyWrite $dir)) {
            throw "Refusing to run: $dir is writable by non-administrators, or is a link. Re-run scripts\register-task.ps1 from an Administrator PowerShell."
        }
    }
    $rootTrusted = $true

    if (-not (Test-Path -LiteralPath $SrumPath)) { throw "SRUM database not found: $SrumPath" }

    # Clear the previous run. `rd /s` removes a junction rather than following
    # it, which Remove-Item -Recurse under PowerShell 5.1 does not promise. The
    # parent is admin-only, so nothing should be here that this script did not
    # put here, but the cost of being wrong would be deleting as Administrator.
    if (Test-Path -LiteralPath $workDir) {
        & cmd.exe /d /c rd /s /q $workDir | Out-Null
        if (Test-Path -LiteralPath $workDir) { throw "Could not clear $workDir" }
    }
    New-Item -ItemType Directory -Path $workDir | Out-Null

    $snapshot = Join-Path $workDir 'SRUDB.dat'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $esentOut = & esentutl.exe /y $SrumPath /vss /d $snapshot 2>&1
    $esentExit = $LASTEXITCODE
    $sw.Stop()
    if ($esentExit -ne 0 -or -not (Test-Path -LiteralPath $snapshot)) {
        throw "esentutl snapshot failed (exit $esentExit): $($esentOut -join '; ')"
    }
    $status.snapshotMB      = [math]::Round((Get-Item -LiteralPath $snapshot).Length / 1MB, 1)
    $status.snapshotSeconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    $status.ok = $true
}
catch {
    $status.error = $_.Exception.Message
}
finally {
    try { Write-Status } catch { }
}

if ($status.ok) { exit 0 } else { exit 1 }
