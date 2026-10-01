<#
    Register (or re-register) the collector's two scheduled tasks.

    MUST RUN AS ADMINISTRATOR.

        .\register-task.ps1              # deploy + create/update both tasks
        .\register-task.ps1 -RunNow      # ...and run a collection immediately
        .\register-task.ps1 -Unregister  # remove both, and the deployed files

    TWO TASKS, SPLIT BY PRIVILEGE (since 2026-09-21)
    ------------------------------------------------

      Data Usage Collector   hourly, NOT elevated. Runs the repo's
                             collector.ps1: parse, ingest, backup. This is
                             also what the dashboard's Sync button starts.
      Data Usage Snapshot    on demand only, elevated. Runs srum-snapshot.ps1,
                             which does the one thing that needs Administrator:
                             a VSS copy of SRUDB.dat.

    The snapshot task runs a COPY of srum-snapshot.ps1 that this script deploys
    into <DeployRoot>\bin, a directory only Administrators can write. It must
    not run the repo's copy: the repo is writable without elevation, and an
    elevated task running a file the user can edit is a free path to
    Administrator. That is exactly how the collector used to be set up. See
    the header of srum-snapshot.ps1.

    THE DEPLOY ROOT IS OFF THE SYSTEM DRIVE (since 3.2.1)
    -----------------------------------------------------

    The snapshot lands in <DeployRoot>\work: ~99 MB, every hour. On C:,
    beside System Restore's shadow copies, that churn is the likeliest cause
    of Fast Startup shutdowns that stalled for up to two minutes with the
    screen off, each logging Volsnap event 25 (shadow storage could not grow
    in time). So -DeployRoot defaults to DataUsageTracker-snapshot at the root
    of the database's drive when that drive is NTFS (the ACL below needs it),
    and to %ProgramData%\DataUsageTracker otherwise. The task's working
    directory is the deploy root, and that is how the collector finds it.

    So after changing srum-snapshot.ps1 or protected-dir.ps1, re-run this to
    deploy them. The collector warns in its log when the deployed copy has
    drifted from the repo.

    Both definitions are exported to scripts/task/ and COMMITTED. The tasks
    live in the Windows task store on C:\ and are destroyed by a reset -- the
    same reset this project exists to survive.
#>

[CmdletBinding()]
param(
    [string]$TaskName         = 'Data Usage Collector',
    [string]$SnapshotTaskName = 'Data Usage Snapshot',
    [ValidateRange(1, 24)]
    [int]$EveryHours          = 1,
    # Where the elevated script and its snapshot live. Default: see above.
    [string]$DeployRoot,
    [switch]$RunNow,
    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Not elevated. Re-run this from an Administrator PowerShell." -ForegroundColor Red
    Write-Host "  cd '$PSScriptRoot'" -ForegroundColor Yellow
    Write-Host "  .\register-task.ps1" -ForegroundColor Yellow
    exit 1
}

# Same defensive resolution as collector.ps1 -- see the note there about
# $PSScriptRoot being empty in some invocation contexts.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot }
             elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path }
             else { $null }
if (-not $scriptDir) { throw "Cannot determine script location. Run this by full path." }

. (Join-Path $scriptDir 'protected-dir.ps1')

$root       = (Resolve-Path (Join-Path $scriptDir '..')).Path
$collector  = Join-Path $root 'scripts\collector.ps1'
$taskDir    = Join-Path $root 'scripts\task'
$cfgPath    = Join-Path $root 'config\collector.json'
$cfg        = if (Test-Path $cfgPath) { Get-Content $cfgPath -Raw | ConvertFrom-Json } else { $null }
$deployed   = @('srum-snapshot.ps1', 'protected-dir.ps1')
$psExe      = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$admins     = [Security.Principal.SecurityIdentifier]'S-1-5-32-544'

if (-not $DeployRoot) {
    $DeployRoot = Join-Path $env:ProgramData 'DataUsageTracker'
    $dbRoot = if ($cfg -and $cfg.databasePath) { [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($cfg.databasePath)) } else { $null }
    if ($dbRoot -and $dbRoot -ine [IO.Path]::GetPathRoot($env:SystemRoot) -and (Test-Path -LiteralPath $dbRoot) -and
        ([IO.DriveInfo]::new($dbRoot)).DriveFormat -eq 'NTFS') {
        $DeployRoot = Join-Path $dbRoot 'DataUsageTracker-snapshot'
    }
}
$deployRoot = [IO.Path]::GetFullPath($DeployRoot)
$binDir     = Join-Path $deployRoot 'bin'

# The user both tasks run as: whoever is signed in, not the admin account
# that elevated this shell. S4U, so no password is stored.
$userSid = (New-Object Security.Principal.NTAccount($env:USERDOMAIN, $env:USERNAME)).Translate(
    [Security.Principal.SecurityIdentifier]).Value

# `rd /s` removes a junction rather than descending through it.
function Remove-DeployRoot([string]$Dir) {
    if (Test-Path -LiteralPath $Dir) {
        & cmd.exe /d /c rd /s /q $Dir | Out-Null
        if (Test-Path -LiteralPath $Dir) {
            throw "Could not remove $Dir. Delete it by hand from an Administrator prompt and re-run."
        }
    }
}

# The deploy root the current registration uses: the snapshot task's working
# directory, wherever -DeployRoot pointed last time. Only a folder that
# Administrators own is returned, so a task definition never talks this
# script into deleting a folder it did not make.
function Get-RegisteredDeployRoot {
    $task = Get-ScheduledTask -TaskName $SnapshotTaskName -ErrorAction SilentlyContinue
    $dir = if ($task) { $task.Actions | Select-Object -First 1 -ExpandProperty WorkingDirectory } else { $null }
    if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { return $null }
    if ((Get-Acl -LiteralPath $dir).GetOwner([Security.Principal.SecurityIdentifier]) -ne $admins) { return $null }
    return [IO.Path]::GetFullPath($dir)
}

if ($Unregister) {
    $registered = Get-RegisteredDeployRoot
    foreach ($name in @($TaskName, $SnapshotTaskName)) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "Removed scheduled task '$name'." -ForegroundColor Green
        } else {
            Write-Host "No task named '$name'." -ForegroundColor Yellow
        }
    }
    foreach ($dir in @($deployRoot, $registered) | Where-Object { $_ } | Select-Object -Unique) {
        Remove-DeployRoot $dir
        Write-Host "Removed $dir." -ForegroundColor Green
    }
    exit 0
}

if (-not (Test-Path $collector)) { throw "collector.ps1 not found at $collector" }

# Moving the deploy root removes the old one, snapshot and all.
$previous = Get-RegisteredDeployRoot
if ($previous -and $previous -ine $deployRoot) {
    Remove-DeployRoot $previous
    Write-Host "Removed the previous $previous" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 1. Deploy the elevated scripts into an admin-only directory
# ---------------------------------------------------------------------------
#
# Rebuilt from nothing every time rather than patched. The directory is
# created WITH its security descriptor, in one call, so there is no moment at
# which it exists with the permissive ACL its parent hands down (Users may
# create files in %ProgramData%'s subfolders, and folders at a drive root). If
# something else created it first, in the gap after the delete, it will not
# have our owner and the check below fails -- which is the right outcome.
Remove-DeployRoot $deployRoot

$security = New-Object System.Security.AccessControl.DirectorySecurity
$security.SetAccessRuleProtection($true, $false)
$security.SetOwner([Security.Principal.SecurityIdentifier]'S-1-5-32-544')
$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$none    = [System.Security.AccessControl.PropagationFlags]::None
foreach ($grant in @(
    @('S-1-5-18',     'FullControl'),     # SYSTEM
    @('S-1-5-32-544', 'FullControl'),     # Administrators
    @($userSid,       'ReadAndExecute')   # the collector reads the snapshot
)) {
    $security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        [Security.Principal.SecurityIdentifier]$grant[0],
        [System.Security.AccessControl.FileSystemRights]$grant[1],
        $inherit, $none, [System.Security.AccessControl.AccessControlType]::Allow)))
}
[System.IO.Directory]::CreateDirectory($deployRoot, $security) | Out-Null

if (@(Get-ChildItem -LiteralPath $deployRoot -Force).Count -ne 0 -or -not (Test-AdminOnlyWrite $deployRoot)) {
    throw "$deployRoot was not created clean and admin-only. Something else may have created it; delete it and re-run."
}

New-Item -ItemType Directory -Path $binDir | Out-Null
foreach ($name in $deployed) {
    Copy-Item -LiteralPath (Join-Path $scriptDir $name) -Destination (Join-Path $binDir $name)
}
foreach ($path in @($deployRoot, $binDir) + @($deployed | ForEach-Object { Join-Path $binDir $_ })) {
    if (-not (Test-AdminOnlyWrite $path)) { throw "Deployed path is writable by non-administrators: $path" }
}
Write-Host "Deployed $($deployed -join ', ') -> $binDir (admin-only)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. The elevated snapshot task: on demand, no trigger
# ---------------------------------------------------------------------------
#
# powershell.exe by full path, so nothing on the user's PATH can stand in for
# it. The working directory is the deploy root, which only admins can write --
# a native program's DLL search includes it.
$snapArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$binDir\srum-snapshot.ps1`""

# The live database path is baked in here, at registration, which an
# Administrator approves -- never read by the task from the user-writable
# config at run time.
if ($cfg) {
    $cfgSrum = $cfg.srumPath
    $defaultSrum = Join-Path $env:SystemRoot 'System32\sru\SRUDB.dat'
    if ($cfgSrum -and $cfgSrum -ne $defaultSrum) { $snapArgs += " -SrumPath `"$cfgSrum`"" }
}

Register-ScheduledTask `
    -TaskName $SnapshotTaskName `
    -Action (New-ScheduledTaskAction -Execute $psExe -Argument $snapArgs -WorkingDirectory $deployRoot) `
    -Principal (New-ScheduledTaskPrincipal -UserId $userSid -LogonType S4U -RunLevel Highest) `
    -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)) `
    -Description 'VSS-copies the Windows SRUM database for the Data Usage Collector. The only elevated step; runs an admin-owned script from its working directory.' `
    -Force | Out-Null
Write-Host "Registered '$SnapshotTaskName' - on demand, highest privileges." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. The collector: hourly, NOT elevated
# ---------------------------------------------------------------------------

# -ExecutionPolicy Bypass so the task does not depend on the machine policy,
# which a Windows reset also resets.
$action = New-ScheduledTaskAction `
    -Execute $psExe `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$collector`" -Quiet" `
    -WorkingDirectory $root

# HOURLY since 2026-09-30, and it was daily before that on purpose: SRUM
# writes hourly and keeps 30+ days, so daily was already LOSSLESS. What daily
# cost was FRESHNESS -- the dashboard reads only the database, so it was up to
# a day behind the machine, with nothing on the page saying so. The Screen Time
# Tracker learned the same lesson and moved its ingest to hourly.
#
# -Once at midnight with a repetition, not 24 daily triggers. No
# -RepetitionDuration: omitting it is what means "forever", and passing
# [TimeSpan]::MaxValue serialises to a value Task Scheduler rejects. A -Once
# trigger keeps its repetition across re-registration; an AtLogOn-only one
# loses it, and the task then silently never repeats.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Hours $EveryHours)

# LIMITED, not Highest. This task runs code from the repo, which the user can
# edit, so it must not carry more privilege than the user already has. The one
# step that needs more is delegated to the snapshot task above.
#
# Running as the current user rather than SYSTEM keeps the D:\ paths
# resolvable, and S4U means it runs whether or not anyone is signed in.
$principal = New-ScheduledTaskPrincipal -UserId $userSid -LogonType S4U -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# StartWhenAvailable is the important one: it runs a missed occurrence once the
# machine is next on. Without it, a laptop that sleeps through its runs simply
# skips them, and enough skipped days in a row means losing data to SRUM
# eviction. IgnoreNew keeps a slow run from stacking under the next hour's.

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Collects Windows per-app network usage hourly into a persistent SQLite database outside the OS partition. Runs unelevated; the VSS snapshot is delegated to the Data Usage Snapshot task.' `
    -Force | Out-Null

Write-Host "Registered '$TaskName' - every $EveryHours hour(s), NOT elevated." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 4. Export both for reset recovery
# ---------------------------------------------------------------------------
#
# MUST be written as UTF-16. Export-ScheduledTask emits XML whose declaration
# says encoding="UTF-16", and schtasks /create /xml rejects the file if the
# bytes do not match that declaration. Writing it as UTF-8 produces a file that
# looks perfectly fine in an editor and then fails as "malformed" at exactly the
# moment you need it, after a reset.
New-Item -ItemType Directory -Force -Path $taskDir | Out-Null
foreach ($name in @($TaskName, $SnapshotTaskName)) {
    $xmlPath = Join-Path $taskDir "$name.xml"
    Set-Content -Path $xmlPath -Value (Export-ScheduledTask -TaskName $name) -Encoding Unicode

    # Verify what we just wrote really is UTF-16, rather than trusting the flag.
    $firstBytes = [System.IO.File]::ReadAllBytes($xmlPath)[0..1]
    if ($firstBytes[0] -eq 0xFF -and $firstBytes[1] -eq 0xFE) {
        Write-Host "Exported -> $xmlPath (UTF-16 LE verified)" -ForegroundColor Green
    } else {
        Write-Host "Exported -> $xmlPath  WARNING: no UTF-16 BOM; schtasks may reject it." -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "  Commit both XMLs." -ForegroundColor DarkGray
Write-Host "  After a Windows reset, re-run THIS script rather than importing them:" -ForegroundColor DarkGray
Write-Host "  it rebuilds the tasks against the new install's user SID, and it" -ForegroundColor DarkGray
Write-Host "  redeploys the snapshot script, which the XML alone cannot do." -ForegroundColor DarkGray
Write-Host ""

if ($RunNow) {
    Write-Host "Starting a collection now..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName

    # Poll so the user gets the outcome instead of a bare "started". The
    # collector now also waits on the snapshot task, so allow it longer.
    for ($i = 0; $i -lt 120; $i++) {
        Start-Sleep -Seconds 2
        $info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
        if ($info.LastTaskResult -ne 267009) { break }   # 267009 = currently running
    }

    $info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
    if ($info.LastTaskResult -eq 0) {
        Write-Host "Collection completed successfully." -ForegroundColor Green
    } else {
        Write-Host "Task result: $($info.LastTaskResult) - check logs\collector-*.log" -ForegroundColor Yellow
    }
}

foreach ($name in @($TaskName, $SnapshotTaskName)) {
    Get-ScheduledTask -TaskName $name |
        Get-ScheduledTaskInfo |
        Select-Object TaskName, LastRunTime, LastTaskResult, NextRunTime |
        Format-List
}
