<#
    Registers (or removes) the logon task that starts the dashboard invisibly.

        powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
        powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove

    Runs as you, only when you are logged on, so Windows never has to store your
    password and no admin rights are needed.

    This is a DIFFERENT task from "Data Usage Collector". That one runs daily,
    elevated, to snapshot SRUM. This one runs at logon, unelevated, to serve the
    dashboard. Removing either does not affect the other -- and note that
    removing this one does not stop data collection.

    ASCII ONLY -- see the note at the top of dashboard-service.ps1.
#>

param([switch]$Remove)

$ErrorActionPreference = 'Stop'

$taskName = 'Start Data Usage Dashboard'
$watchName = 'Data Usage Network Watch'
$root = Split-Path -Parent $PSScriptRoot
$vbs = Join-Path $root 'scripts\dashboard-hidden.vbs'

if ($Remove) {
    if (Get-ScheduledTask -TaskName $watchName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $watchName -Confirm:$false
        Write-Host "Removed the '$watchName' task."
    }
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Removed the '$taskName' logon task. The dashboard will no longer start automatically."
        Write-Host "Anything already running keeps running - use scripts\dashboard-stop.ps1 to stop it."
        Write-Host "Data collection is unaffected; that is the separate 'Data Usage Collector' task."
    } else {
        Write-Host "No '$taskName' task is registered."
    }
    exit 0
}

if (-not (Test-Path $vbs)) { throw "Launcher not found at $vbs" }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $vbs)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Defaults built for laptops actively fight a long-running server: Windows will
# refuse to start it on battery and kill it after three days. Turn all of that
# off. StartWhenAvailable catches a logon the task missed.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName `
    -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Starts the local Data Usage Dashboard in the background at logon (http://localhost:7843).' `
    -Force | Out-Null

Write-Host "Registered '$taskName'. It will start the dashboard hidden at every logon."

# -----------------------------------------------------------------------------
# Network watch
# -----------------------------------------------------------------------------
#
# SRUM stores a numeric profile id and no name, so names are OBSERVED: we record
# what the machine is connected to and attribute it once the matching hour has
# been written and carries only that profile. The daily collector samples once a
# day, which is far too coarse -- every observation can land in the one hour a
# network changed, and all of them are then ambiguous.
#
# This task samples four times an hour. It is deliberately NOT the collector
# running more often: the collector VSS-copies a ~99 MB database each run, while
# this is one insert.
#
# It is launched through a VBS wrapper for the same reason the dashboard is:
# powershell -WindowStyle Hidden STILL flashes a console window up, and at four
# times an hour that is impossible to ignore. WScript.Shell's Run with window
# style 0 does not create one, and the node.exe the script launches inherits
# that hidden console instead of opening its own.
$watchScript = Join-Path $root 'scripts\observe-network.ps1'
$watchVbs = Join-Path $root 'scripts\network-watch-hidden.vbs'
if ((Test-Path $watchScript) -and (Test-Path $watchVbs)) {
    $watchAction = New-ScheduledTaskAction `
        -Execute 'wscript.exe' `
        -Argument ('"{0}"' -f $watchVbs) `
        -WorkingDirectory $root

    # Repeat indefinitely. Do NOT pass -RepetitionDuration ([TimeSpan]::MaxValue):
    # it serialises as P99999999DT23H59M59S, which Task Scheduler rejects as out
    # of range. Omitting the duration is what means "forever".
    $repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes 15)).Repetition

    # TWO triggers, and the second is not redundant. Re-registering a task whose
    # only trigger is AtLogOn clears the running repetition: NextRunTime goes
    # empty and nothing samples until the next logon, which on a machine left on
    # for days means the watch silently stops. The Once trigger starts the
    # repetition now; the AtLogOn one restarts it every session.
    $watchLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $watchLogon.Repetition = $repetition
    $watchNow = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
    $watchNow.Repetition = $repetition
    $watchTrigger = @($watchLogon, $watchNow)

    $watchSettings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -DontStopOnIdleEnd `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
        -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $watchName `
        -Action $watchAction -Trigger $watchTrigger -Settings $watchSettings `
        -Description 'Records which network this machine is on, so SRUM profile ids can be given names.' `
        -Force | Out-Null

    Write-Host "Registered '$watchName'. It samples the current network every 15 minutes, with no window."
}
Write-Host ""
Write-Host "Start it now without logging out:"
Write-Host "  wscript scripts\dashboard-hidden.vbs"
Write-Host ""
Write-Host "Then open http://localhost:7843"
Write-Host "Logs: logs\dashboard.log   Stop: scripts\dashboard-stop.ps1"
