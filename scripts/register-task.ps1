<#
    Register (or re-register) the collector's two scheduled tasks.

    MUST RUN AS ADMINISTRATOR.

        .\register-task.ps1              # deploy + create/update both tasks
        .\register-task.ps1 -RunNow      # ...and run a collection immediately
        .\register-task.ps1 -Unregister  # remove both, and the deployed files

    TWO TASKS, SPLIT BY PRIVILEGE (since 2026-09-21)
    ------------------------------------------------

      Data Usage Collector   daily 03:30, NOT elevated. Runs the repo's
                             collector.ps1: parse, ingest, backup. This is
                             also what the dashboard's Sync button starts.
      Data Usage Snapshot    on demand only, elevated. Runs srum-snapshot.ps1,
                             which does the one thing that needs Administrator:
                             a VSS copy of SRUDB.dat.

    The snapshot task runs a COPY of srum-snapshot.ps1 that this script deploys
    into %ProgramData%\DataUsageTracker\bin, a directory only Administrators
    can write. It must not run the repo's copy: the repo is writable without
    elevation, and an elevated task running a file the user can edit is a
    free path to Administrator. That is exactly how the collector used to be
    set up. See the header of srum-snapshot.ps1.

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
    [string]$Time             = '03:30',
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
$deployRoot = Join-Path $env:ProgramData 'DataUsageTracker'
$binDir     = Join-Path $deployRoot 'bin'
$deployed   = @('srum-snapshot.ps1', 'protected-dir.ps1')
$psExe      = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# The user both tasks run as: whoever is signed in, not the admin account
# that elevated this shell. S4U, so no password is stored.
$userSid = (New-Object Security.Principal.NTAccount($env:USERDOMAIN, $env:USERNAME)).Translate(
    [Security.Principal.SecurityIdentifier]).Value

# `rd /s` removes a junction rather than descending through it.
function Remove-DeployRoot {
    if (Test-Path -LiteralPath $deployRoot) {
        & cmd.exe /d /c rd /s /q $deployRoot | Out-Null
        if (Test-Path -LiteralPath $deployRoot) {
            throw "Could not remove $deployRoot. Delete it by hand from an Administrator prompt and re-run."
        }
    }
}

if ($Unregister) {
    foreach ($name in @($TaskName, $SnapshotTaskName)) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "Removed scheduled task '$name'." -ForegroundColor Green
        } else {
            Write-Host "No task named '$name'." -ForegroundColor Yellow
        }
    }
    Remove-DeployRoot
    Write-Host "Removed $deployRoot." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $collector)) { throw "collector.ps1 not found at $collector" }

# ---------------------------------------------------------------------------
# 1. Deploy the elevated scripts into an admin-only directory
# ---------------------------------------------------------------------------
#
# Rebuilt from nothing every time rather than patched. The directory is
# created WITH its security descriptor, in one call, so there is no moment at
# which it exists with the permissive ACL %ProgramData% hands down (Users may
# create files in subfolders there). If something else created it first, in
# the gap after the delete, it will not have our owner and the check below
# fails -- which is the right outcome.
Remove-DeployRoot

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
$cfgPath = Join-Path $root 'config\collector.json'
if (Test-Path $cfgPath) {
    $cfgSrum = (Get-Content $cfgPath -Raw | ConvertFrom-Json).srumPath
    $defaultSrum = Join-Path $env:SystemRoot 'System32\sru\SRUDB.dat'
    if ($cfgSrum -and $cfgSrum -ne $defaultSrum) { $snapArgs += " -SrumPath `"$cfgSrum`"" }
}

Register-ScheduledTask `
    -TaskName $SnapshotTaskName `
    -Action (New-ScheduledTaskAction -Execute $psExe -Argument $snapArgs -WorkingDirectory $deployRoot) `
    -Principal (New-ScheduledTaskPrincipal -UserId $userSid -LogonType S4U -RunLevel Highest) `
    -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)) `
    -Description 'VSS-copies the Windows SRUM database for the Data Usage Collector. The only elevated step; runs an admin-owned script from %ProgramData%\DataUsageTracker.' `
    -Force | Out-Null
Write-Host "Registered '$SnapshotTaskName' - on demand, highest privileges." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. The collector: daily, NOT elevated
# ---------------------------------------------------------------------------

# -ExecutionPolicy Bypass so the task does not depend on the machine policy,
# which a Windows reset also resets.
$action = New-ScheduledTaskAction `
    -Execute $psExe `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$collector`" -Quiet" `
    -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

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
# machine is next on. Without it, a laptop that is asleep at 03:30 simply skips
# the day, and enough skipped days in a row means losing data to SRUM eviction.

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Collects Windows per-app network usage daily into a persistent SQLite database outside the OS partition. Runs unelevated; the VSS snapshot is delegated to the Data Usage Snapshot task.' `
    -Force | Out-Null

Write-Host "Registered '$TaskName' - daily at $Time, NOT elevated." -ForegroundColor Green

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
