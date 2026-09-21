<#
    Restore the working database from the backup.

        .\restore.ps1              # inspect, confirm, restore
        .\restore.ps1 -Force       # skip the confirmation prompt
        .\restore.ps1 -WhatIf      # report only, change nothing

    Run this after a Windows reset, once the repo is cloned and `npm install`
    has run. It does NOT need Administrator -- only the collector does.

    Why the backup and not the live file:

    In WAL mode a SQLite database is three files (.db, .db-wal, .db-shm) that
    must be mutually consistent. D:\PersistentData is mirrored to Google Drive,
    and a sync client that uploads those three at slightly different moments
    produces a cloud copy that looks perfectly fine and restores wrong. The
    backup is written by SQLite's own backup API as a single self-contained
    file, which is why it is the restore source.
#>

[CmdletBinding()]
param(
    [string]$ConfigPath,
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot }
             elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path }
             else { $null }
if (-not $scriptDir) { throw "Cannot determine script location. Run this by full path." }

$root = (Resolve-Path (Join-Path $scriptDir '..')).Path
if (-not $ConfigPath) { $ConfigPath = Join-Path $root 'config\collector.json' }
if (-not (Test-Path $ConfigPath)) { throw "Config not found: $ConfigPath" }

$cfg    = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$live   = $cfg.databasePath
$backup = $cfg.backupPath

function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Write-Bad  { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }
function Write-Step { param($m) Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# Inspect a database file. PowerShell has no SQLite reader, so this shells out
# to a small committed helper rather than an inline snippet -- see db-info.mjs.
function Get-DbInfo {
    param([string]$Path)
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $node) { throw "node.exe not found. Install Node 22+ first." }
    $helper = Join-Path $PSScriptRoot 'db-info.mjs'
    if (-not (Test-Path $helper)) { throw "Helper not found: $helper" }
    $json = & $node $helper $Path 2>&1 | Select-Object -Last 1
    return $json | ConvertFrom-Json
}

Write-Step "Source"

if (-not (Test-Path $backup)) {
    Write-Bad "Backup not found: $backup"
    Write-Host ""
    Write-Host "  If this is a fresh machine, check that D:\ actually survived and that" -ForegroundColor Yellow
    Write-Host "  Google Drive has finished syncing the folder down." -ForegroundColor Yellow
    exit 1
}

$info = Get-DbInfo $backup
if (-not $info.ok) { Write-Bad "Backup is not a readable database: $($info.error)"; exit 1 }
if ($info.integrity -ne 'ok') { Write-Bad "Backup failed integrity_check: $($info.integrity)"; exit 1 }

Write-Ok "$backup"
Write-Ok "$($info.rows) rows - $($info.days) days - $($info.first) -> $($info.last) - integrity ok"

Write-Step "Destination"

$liveExists = Test-Path $live
if ($liveExists) {
    $liveInfo = Get-DbInfo $live
    if ($liveInfo.ok) {
        Write-Warn "A working database already exists here:"
        Write-Host "         $live" -ForegroundColor DarkGray
        Write-Host "         $($liveInfo.rows) rows - $($liveInfo.first) -> $($liveInfo.last)" -ForegroundColor DarkGray
        if ($liveInfo.rows -gt $info.rows) {
            Write-Warn "It holds MORE rows than the backup ($($liveInfo.rows) vs $($info.rows))."
            Write-Warn "Restoring would move you backwards. Is this really what you want?"
        }
    } else {
        Write-Warn "Existing file is unreadable and will be replaced."
    }
} else {
    Write-Ok "No existing database -- clean restore."
}

if ($DryRun) {
    Write-Step "Dry run -- nothing changed"
    Write-Host "  Would copy the backup to $live" -ForegroundColor DarkGray
    exit 0
}

if (-not $Force) {
    Write-Host ""
    $ans = Read-Host "  Restore $($info.rows) rows to $live ? [y/N]"
    if ($ans -notmatch '^[Yy]') { Write-Host "  Cancelled." -ForegroundColor Yellow; exit 0 }
}

Write-Step "Restoring"

$liveDir = Split-Path -Parent $live
New-Item -ItemType Directory -Force -Path $liveDir | Out-Null

# Move the existing database aside rather than overwriting it. If the backup
# turns out to be older than expected, the only other copy should still exist.
if ($liveExists) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $aside = "$live.replaced-$stamp"
    Move-Item -Path $live -Destination $aside -Force
    Write-Ok "Existing database moved aside -> $(Split-Path -Leaf $aside)"
}

# Remove stale WAL sidecars at the DESTINATION before copying.
#
# This is the step that matters. A -wal/-shm pair left over from a different
# database will be replayed against the file we just put there, and SQLite has
# no way to know they do not belong together. Read-only connections (the
# dashboard opens one per request) cannot clean these up on close, so they
# routinely outlive the database they came from.
foreach ($suffix in '-wal', '-shm') {
    $sidecar = "$live$suffix"
    if (Test-Path $sidecar) {
        Remove-Item $sidecar -Force
        Write-Ok "Removed stale $suffix at destination"
    }
}

Copy-Item -Path $backup -Destination $live -Force
Write-Ok "Copied backup -> $live"

Write-Step "Verifying"

$check = Get-DbInfo $live
if (-not $check.ok)                    { Write-Bad "Restored file is unreadable: $($check.error)"; exit 1 }
if ($check.integrity -ne 'ok')         { Write-Bad "Restored file failed integrity_check"; exit 1 }
if ($check.rows -ne $info.rows)        { Write-Bad "Row count mismatch: $($check.rows) vs $($info.rows)"; exit 1 }

Write-Ok "$($check.rows) rows - $($check.first) -> $($check.last) - integrity ok"

Write-Step "Next"
Write-Host "  1. Re-register the scheduled task (elevated):" -ForegroundColor DarkGray
Write-Host "       .\register-task.ps1 -RunNow" -ForegroundColor DarkGray
Write-Host ""
Write-Host "     Prefer this over importing scripts\task\*.xml: the exported" -ForegroundColor DarkGray
Write-Host "     <UserId> is the OLD install's SID, and a reset generates a new one." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  2. Check the dashboard:  npm run dev  ->  http://localhost:7843" -ForegroundColor DarkGray
Write-Host ""
