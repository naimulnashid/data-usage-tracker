<#
    Phase 1 -- validate that we can actually read SRUM.

    MUST RUN AS ADMINISTRATOR. The VSS snapshot step is the only reason why;
    everything after it is ordinary file work.

    This script does NOT write to the persistent database and does NOT install
    anything. It proves three things and then stops:

      1. We can snapshot the locked SRUDB.dat via Volume Shadow Copy.
      2. SrumECmd can parse that snapshot on this machine's .NET runtime.
      3. The per-app byte totals are sane -- which you confirm by eye against
         Settings > Network & Internet > Data usage.

    Point 3 is the one that matters. Everything downstream assumes SRUM's byte
    columns sum the way we think they do. Validate it here, once, before any
    schema or dashboard work depends on it.
#>

[CmdletBinding()]
param(
    # Where to stage the snapshot + CSVs. Not the persistent DB location --
    # this is scratch, and the script offers to delete it at the end.
    [string]$WorkDir = "$env:TEMP\srum-phase1",

    # Folder containing SrumECmd.exe. Download it yourself from
    # https://ericzimmerman.github.io/ -- this script deliberately does not
    # fetch binaries for you.
    [string]$SrumECmdDir = "",

    # How many days back to summarise in the sanity report.
    [int]$Days = 30,

    [switch]$KeepWorkDir
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($m) Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Write-Bad  { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# 0. Preflight
# ---------------------------------------------------------------------------
Write-Step "Preflight"

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Bad "Not elevated. esentutl /vss will fail."
    Write-Host ""
    Write-Host "  Re-run from an ADMIN PowerShell:" -ForegroundColor Yellow
    Write-Host "    cd '$PSScriptRoot'" -ForegroundColor Yellow
    Write-Host "    .\phase1-validate.ps1" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
Write-Ok "Running elevated."

$srcDb = "$env:SystemRoot\System32\sru\SRUDB.dat"
if (-not (Test-Path $srcDb)) { Write-Bad "SRUDB.dat not found at $srcDb"; exit 1 }
$srcItem = Get-Item $srcDb -Force
$srcSize = [math]::Round($srcItem.Length / 1MB, 1)
Write-Ok "SRUDB.dat present ($srcSize MB, modified $($srcItem.LastWriteTime))."

# Locate SrumECmd. Explicit param wins, then PATH, then the usual install spots.
$srumECmd = $null
if ($SrumECmdDir -and (Test-Path (Join-Path $SrumECmdDir 'SrumECmd.exe'))) {
    $srumECmd = (Resolve-Path (Join-Path $SrumECmdDir 'SrumECmd.exe')).Path
} else {
    $onPath = Get-Command SrumECmd.exe -ErrorAction SilentlyContinue
    if ($onPath) {
        $srumECmd = $onPath.Source
    } else {
        foreach ($guess in @(
            "$PSScriptRoot\tools\SrumECmd.exe",
            "C:\Tools\SrumECmd.exe",
            "C:\Tools\ZimmermanTools\SrumECmd.exe",
            "C:\Tools\ZimmermanTools\net9\SrumECmd.exe",
            "C:\Tools\ZimmermanTools\net6\SrumECmd.exe"
        )) {
            if (Test-Path $guess) { $srumECmd = $guess; break }
        }
    }
}

if (-not $srumECmd) {
    Write-Warn "SrumECmd.exe not found."
    Write-Host ""
    Write-Host "  Download it (this script will not fetch binaries for you):" -ForegroundColor Yellow
    Write-Host "    https://ericzimmerman.github.io/   ->  SrumECmd" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Then re-run with:" -ForegroundColor Yellow
    Write-Host "    .\phase1-validate.ps1 -SrumECmdDir 'C:\Tools\ZimmermanTools'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  The snapshot step still runs below, so VSS gets proven either way." -ForegroundColor DarkGray
} else {
    Write-Ok "SrumECmd: $srumECmd"
}

# .NET runtime check. EZ tools ship net6 and net9 builds; this box has .NET 8,
# so a net6 build needs roll-forward and a net9 build needs the 9 runtime.
$runtimeVersions = @()
try {
    $runtimeVersions = @(
        & dotnet --list-runtimes 2>$null |
            Where-Object { $_ -match 'Microsoft\.NETCore\.App' } |
            ForEach-Object { ($_ -split ' ')[1] }
    )
} catch {}

if ($runtimeVersions.Count) {
    Write-Ok ".NET runtimes: $($runtimeVersions -join ', ')"
    $hasUsable = $runtimeVersions | Where-Object { $_ -match '^(6|9)\.' }
    if (-not $hasUsable) {
        Write-Warn "No .NET 6 or 9 runtime. If SrumECmd fails to launch, set:"
        Write-Host '           $env:DOTNET_ROLL_FORWARD = "Major"' -ForegroundColor DarkGray
        Write-Host "         ...then retry, or install the runtime from https://dotnet.microsoft.com/download" -ForegroundColor DarkGray
    }
} else {
    Write-Warn "dotnet CLI not found. Only matters for framework-dependent SrumECmd builds."
}

. (Join-Path $PSScriptRoot 'srum-recover.ps1')

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
# Named SRUDB.dat because soft recovery below looks the database up by the name
# recorded in the log stream. See srum-recover.ps1.
$snapshot = Join-Path $WorkDir 'SRUDB.dat'
$csvOut   = Join-Path $WorkDir 'csv'
Write-Ok "Work dir: $WorkDir"

# ---------------------------------------------------------------------------
# 1. VSS snapshot of the locked database
# ---------------------------------------------------------------------------
Write-Step "1. VSS snapshot"

if (Test-Path $snapshot) { Remove-Item $snapshot -Force }

$sw = [Diagnostics.Stopwatch]::StartNew()
# /y = copy source, /vss = read through a shadow copy (handles the live lock),
# /d = destination file.
$esentOut = & esentutl.exe /y $srcDb /vss /d $snapshot 2>&1
$esentExit = $LASTEXITCODE
$sw.Stop()

if ($esentExit -ne 0 -or -not (Test-Path $snapshot)) {
    Write-Bad "esentutl snapshot failed (exit $esentExit)."
    $esentOut | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-Host ""
    Write-Host "  Common causes: VSS service disabled, or not enough free space" -ForegroundColor Yellow
    Write-Host "  on C: for a shadow copy. Check with:  vssadmin list writers" -ForegroundColor Yellow
    exit 1
}

$snapSize = [math]::Round((Get-Item $snapshot).Length / 1MB, 1)
Write-Ok "Snapshot written: $snapSize MB in $([math]::Round($sw.Elapsed.TotalSeconds,1))s"

# ---------------------------------------------------------------------------
# 1b. Soft recovery
# ---------------------------------------------------------------------------
Write-Step "1b. Soft recovery"

Write-Host "  A VSS copy of a live ESE database reports 'Dirty Shutdown', and" -ForegroundColor DarkGray
Write-Host "  SrumECmd refuses to attach one. Replaying the journals is what" -ForegroundColor DarkGray
Write-Host "  makes it parseable -- see scripts\srum-recover.ps1." -ForegroundColor DarkGray

$rec = Invoke-SrumSoftRecovery -WorkDir $WorkDir -SrumDir (Split-Path -Parent $srcDb)
$rec.Warnings | ForEach-Object { Write-Warn $_ }
if ($rec.Ok -and $rec.Repaired) {
    Write-Warn "Replay fell short of a clean database; hard repair fixed the copy."
    Write-Host "    The current journal generation (SRU.log) is held by the SRUM" -ForegroundColor DarkGray
    Write-Host "    service while it flushes. See scripts\srum-recover.ps1." -ForegroundColor DarkGray
} elseif ($rec.Ok) {
    Write-Ok "Recovered: $($rec.LogsCopied) journals replayed, database is clean"
} else {
    Write-Warn "Recovery failed: database is '$($rec.State)' (exit $($rec.ExitCode)). The parse below will say so."
    $rec.Output | Select-Object -Last 3 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}

if (-not $srumECmd) {
    Write-Step "Stopping: snapshot proven, SrumECmd missing"
    Write-Host "  Snapshot left at: $snapshot" -ForegroundColor Yellow
    Write-Host "  Delete it manually when done -- it is your full usage history." -ForegroundColor Yellow
    exit 2
}

# ---------------------------------------------------------------------------
# 2. Parse
# ---------------------------------------------------------------------------
Write-Step "2. Parse with SrumECmd"

if (Test-Path $csvOut) { Remove-Item $csvOut -Recurse -Force }
New-Item -ItemType Directory -Force -Path $csvOut | Out-Null

$sw = [Diagnostics.Stopwatch]::StartNew()
& $srumECmd -f $snapshot --csv $csvOut 2>&1 |
    ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
$sw.Stop()

$netCsv = Get-ChildItem $csvOut -Filter '*NetworkUsage*.csv' -Recurse -ErrorAction SilentlyContinue |
          Sort-Object Length -Descending | Select-Object -First 1

if (-not $netCsv) {
    Write-Bad "No NetworkUsage CSV produced. Files found:"
    Get-ChildItem $csvOut -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host "    $($_.Name)" -ForegroundColor DarkGray }
    exit 1
}
Write-Ok "Parsed in $([math]::Round($sw.Elapsed.TotalSeconds,1))s -> $($netCsv.Name)"

# ---------------------------------------------------------------------------
# 3. Sanity report -- the part you actually check
# ---------------------------------------------------------------------------
Write-Step "3. Sanity report"

$rows = @(Import-Csv $netCsv.FullName)
Write-Ok "$($rows.Count) network rows."
if ($rows.Count -eq 0) { Write-Bad "Empty table. Nothing to validate."; exit 1 }

# Discover column names rather than hardcoding them -- SrumECmd has renamed
# these across versions, and guessing wrong silently reports zeros.
#
# Match against an ORDERED list of exact names, not a regex alternation.
# A regex returns whichever column happens to come first in CSV order, which
# is how the first run of this script picked `SidType` (an enum) instead of
# `UserId` -- and that made the dedup test far coarser than intended.
$cols = $rows[0].PSObject.Properties.Name
function Get-Col {
    param([string[]]$Preferred, [string]$Fallback)
    foreach ($name in $Preferred) {
        $hit = $cols | Where-Object { $_ -eq $name } | Select-Object -First 1
        if ($hit) { return $hit }
    }
    if ($Fallback) { return ($cols | Where-Object { $_ -match $Fallback } | Select-Object -First 1) }
    return $null
}

$colTime  = Get-Col @('Timestamp') 'Timestamp'
$colApp   = Get-Col @('ExeInfo') '^Exe'
$colAppId = Get-Col @('AppId')
$colSent  = Get-Col @('BytesSent') 'BytesSent'
$colRecv  = Get-Col @('BytesReceived') 'BytesRec'
$colIface = Get-Col @('InterfaceLuid') 'Interface'
$colIfType= Get-Col @('InterfaceType')
$colUser  = Get-Col @('UserId', 'Sid') 'UserName'
$colL2    = Get-Col @('L2ProfileId')

Write-Host "  Column mapping (compare with docs/DESIGN.md):" -ForegroundColor DarkGray
Write-Host "    time=$colTime  app=$colApp  appId=$colAppId  sent=$colSent" -ForegroundColor DarkGray
Write-Host "    recv=$colRecv  iface=$colIface  ifType=$colIfType  user=$colUser  l2=$colL2" -ForegroundColor DarkGray

foreach ($pair in @(@('timestamp', $colTime), @('app', $colApp),
                    @('bytes sent', $colSent), @('bytes received', $colRecv))) {
    if (-not $pair[1]) {
        Write-Bad "No '$($pair[0])' column found. Columns present:"
        Write-Host "    $($cols -join ', ')" -ForegroundColor DarkGray
        exit 1
    }
}

$cutoff = (Get-Date).AddDays(-$Days)
$recent = @($rows | Where-Object {
    $t = [datetime]::MinValue
    [datetime]::TryParse($_.$colTime, [ref]$t) -and $t -ge $cutoff
})
Write-Ok "$($recent.Count) rows within the last $Days days."

if ($recent.Count -eq 0) {
    Write-Warn "No recent rows -- inspect the timestamp format by hand:"
    $rows | Select-Object -First 3 | Format-List | Out-String | Write-Host
    exit 1
}

$span = @($recent | ForEach-Object { [datetime]$_.$colTime } | Sort-Object)
Write-Ok "Coverage: $($span[0].ToString('yyyy-MM-dd HH:mm')) -> $($span[-1].ToString('yyyy-MM-dd HH:mm'))"

# AppId 1 is NOT an application. It is the per-interface AGGREGATE row that
# SRUM writes each hour, and it equals the sum of every named app in that hour.
# Summing all rows together therefore double-counts everything. Confirmed
# empirically 2026-08-20: aggregate and named-app totals over the same 30 days
# agree to 0.1%.
$aggRows   = @($recent | Where-Object { $_.$colAppId -eq '1' })
$appRows   = @($recent | Where-Object { $_.$colAppId -ne '1' })

$aggSent   = [double](($aggRows | Measure-Object -Property $colSent -Sum).Sum)
$aggRecv   = [double](($aggRows | Measure-Object -Property $colRecv -Sum).Sum)
$appSent   = [double](($appRows | Measure-Object -Property $colSent -Sum).Sum)
$appRecv   = [double](($appRows | Measure-Object -Property $colRecv -Sum).Sum)

$aggGB = ($aggSent + $aggRecv) / 1GB
$appGB = ($appSent + $appRecv) / 1GB

Write-Host ""
Write-Host "  ------------------------------------------------------------" -ForegroundColor White
Write-Host "   GROUND-TRUTH CHECK -- last $Days days" -ForegroundColor White
Write-Host "  ------------------------------------------------------------" -ForegroundColor White
Write-Host ("   Sent:     {0,10:N2} GB" -f ($aggSent / 1GB)) -ForegroundColor White
Write-Host ("   Received: {0,10:N2} GB" -f ($aggRecv / 1GB)) -ForegroundColor White
Write-Host ("   TOTAL:    {0,10:N2} GB   <- compare this one" -f $aggGB) -ForegroundColor Cyan
Write-Host "  ------------------------------------------------------------" -ForegroundColor White
Write-Host ("   sum of named apps      : {0,10:N2} GB" -f $appGB) -ForegroundColor DarkGray
Write-Host ("   unattributed remainder : {0,10:N2} GB ({1:N1}%)" -f ($aggGB - $appGB),
            $(if ($aggGB) { (($aggGB - $appGB) / $aggGB) * 100 } else { 0 })) -ForegroundColor DarkGray
Write-Host ("   naive sum of ALL rows  : {0,10:N2} GB  <- WRONG, double-counted" -f ($aggGB + $appGB)) -ForegroundColor DarkGray
Write-Host "  ------------------------------------------------------------" -ForegroundColor White
Write-Host ""
Write-Host "   >> Open Settings > Network & Internet > Data usage and compare TOTAL." -ForegroundColor Yellow
Write-Host "   >> Same ballpark  = byte columns are per-interval deltas. Sum them." -ForegroundColor Yellow
Write-Host "   >> Wildly larger  = they are cumulative counters, and ingest must" -ForegroundColor Yellow
Write-Host "                       diff consecutive rows per app instead." -ForegroundColor Yellow
Write-Host ""

# Top consumers -- the second eyeball check: do these look like your real apps?
# Uses $appRows, so the AppId 1 aggregate does not appear as a nameless app.
Write-Host "  Top 15 apps by total bytes (AppId 1 aggregate excluded):" -ForegroundColor White
$appRows |
    Group-Object $colApp |
    ForEach-Object {
        $s = [double](($_.Group | Measure-Object -Property $colSent -Sum).Sum)
        $r = [double](($_.Group | Measure-Object -Property $colRecv -Sum).Sum)
        $name = $_.Name
        if ($name.Length -gt 58) { $name = '...' + $name.Substring($name.Length - 55) }
        [pscustomobject]@{
            App     = $name
            TotalGB = [math]::Round(($s + $r) / 1GB, 3)
            SentMB  = [math]::Round($s / 1MB, 1)
            RecvMB  = [math]::Round($r / 1MB, 1)
            Rows    = $_.Count
        }
    } |
    Sort-Object TotalGB -Descending |
    Select-Object -First 15 |
    Format-Table -AutoSize | Out-String -Width 120 | Write-Host

# Identity kinds -- confirms the app_id / app_kind split is actually needed.
$exeLike = @($recent | Where-Object { $_.$colApp -match '\\' }).Count
$other   = $recent.Count - $exeLike
Write-Host "  App identity kinds: $exeLike path-like, $other non-path (AppX package / service)." -ForegroundColor DarkGray

# Interface spread -- confirms the dedup key must include the interface.
if ($colIface) {
    $ifaces = @($recent | Group-Object $colIface | Sort-Object Count -Descending)
    Write-Host "  Distinct interfaces: $($ifaces.Count)" -ForegroundColor DarkGray
    $ifaces | Select-Object -First 6 | ForEach-Object {
        Write-Host "    $($_.Name)  ($($_.Count) rows)" -ForegroundColor DarkGray
    }
}

# Dedup-key proof. If the key collides, Phase 2's UNIQUE index silently drops
# real traffic; if it is too loose, re-running the collector duplicates rows.
#
# Settled 2026-08-20 by testing candidates against 18,476 real rows:
#   time+app+sidType+iface            -> 91 collisions  (SidType is an enum, useless)
#   time+appId+userId+iface           -> 91 collisions
#   time+appId+userId+iface+l2Profile ->  7 collisions
#   ...+bytesSent+bytesReceived       ->  0 collisions
#
# The last 7 were genuinely DISTINCT measurements (e.g. 11,810 vs 977,002,503
# bytes at the same minute) -- SRUM writes extra rows at sleep/shutdown, off the
# hourly cadence. They must both be kept, so the byte values join the key.
$keyParts = @($colTime, $colAppId) +
            @(@($colUser, $colIface, $colL2) | Where-Object { $_ }) +
            @($colSent, $colRecv)

$seen = @{}
$dupCount = 0
foreach ($row in $recent) {
    $k = (@($keyParts | ForEach-Object { $row.$_ })) -join '|'
    if ($seen.ContainsKey($k)) { $dupCount++ } else { $seen[$k] = $true }
}
if ($dupCount -eq 0) {
    Write-Ok "Dedup key unique across all $($recent.Count) rows: $($keyParts -join ' + ')"
} else {
    Write-Warn "Dedup key collides on $dupCount rows -- investigate before Phase 2."
}

Write-Step "Done"
Write-Host "  Snapshot: $snapshot" -ForegroundColor DarkGray
Write-Host "  CSVs:     $csvOut" -ForegroundColor DarkGray
Write-Host ""

if (-not $KeepWorkDir) {
    Write-Host "  The work dir holds a full copy of this machine's usage history" -ForegroundColor Yellow
    Write-Host "  ($snapSize MB) sitting in TEMP." -ForegroundColor Yellow
    $ans = Read-Host "  Delete $WorkDir ? [Y/n]"
    if ($ans -eq '' -or $ans -match '^[Yy]') {
        Remove-Item $WorkDir -Recurse -Force
        Write-Ok "Cleaned up."
    } else {
        Write-Warn "Left in place. It contains real usage data -- delete it yourself later."
    }
}
