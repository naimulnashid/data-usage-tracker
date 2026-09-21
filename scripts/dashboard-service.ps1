<#
    Runs the Data Usage Dashboard in the background, with no console window.

    Invoked by scripts\dashboard-hidden.vbs, which is what the "Data Usage
    Dashboard" logon task runs. Safe to run by hand too.

    Nothing is visible while this runs, so everything it does is appended to
    logs\dashboard.log. That file is the only way to find out why the dashboard
    did not come up.

    ASCII ONLY -- do not paste in an em-dash or a bullet. Windows PowerShell 5.1
    reads a BOM-less .ps1 as ANSI, and a UTF-8 em-dash decodes to CP1252 0x94 =
    U+201D, which PowerShell accepts as a STRING DELIMITER. It closes the string
    early and silently changes the logic of the enclosing block. This bit
    restore.ps1 once already; the reset drill now checks for it.
#>

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is reliable in the body (it is NOT during param() defaults).
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$port = 7843
$logDir = Join-Path $root 'logs'
$log = Join-Path $logDir 'dashboard.log'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

<#
    The log has more than one writer at once. While the dashboard runs, its
    output streams in here for as long as it lives - and a second launch (a
    re-run task, a double-clicked .vbs) still has to add its "Already running"
    line. Out-File and Add-Content both open the file refusing other writers,
    so that line used to be lost and the launch crashed on an IOException.

    So every writer here opens the log sharing it (FileShare.ReadWrite), with
    the AppendData right and nothing else. That right is what makes sharing
    safe: with no general write access, Windows places each write at the end of
    the file as one operation, wherever it has grown to since. A plain write
    handle keeps its own position, and seeking to the end before each write is
    not enough - measured in a sibling project with two processes appending at
    once, seek-then-write lost 2677 of 6000 lines, each written over by the
    other; AppendData lost none, in Windows PowerShell 5.1 and PowerShell 7.

    One Write() per line keeps each line one operation. The bytes are what
    Out-File wrote: UTF-8, CRLF, and a BOM on a new file.
#>
$logEncoding = New-Object System.Text.UTF8Encoding $false
$logPreamble = (New-Object System.Text.UTF8Encoding $true).GetPreamble()

function Open-LogStream {
    $mode = [System.IO.FileMode]::Append
    $rights = [System.Security.AccessControl.FileSystemRights]::AppendData
    $share = [System.IO.FileShare]::ReadWrite
    $none = [System.IO.FileOptions]::None
    if ($PSVersionTable.PSEdition -eq 'Core') {
        # .NET Core dropped this FileStream constructor; the same call lives here.
        return [System.IO.FileSystemAclExtensions]::Create((New-Object System.IO.FileInfo $log),
            $mode, $rights, $share, 4096, $none, $null)
    }
    return New-Object System.IO.FileStream($log, $mode, $rights, $share, 4096, $none)
}

function Add-LogLine([System.IO.FileStream]$stream, [string]$text) {
    $bytes = $logEncoding.GetBytes($text + [Environment]::NewLine)
    if ($stream.Length -eq 0) { $bytes = [byte[]]($logPreamble + $bytes) }
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
}

function Write-Log($message) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    # Logging is never what stops this script. A writer that does not share -
    # a copy of this script from before the log was shared, still serving -
    # can hold the file for hours, so try briefly and then carry on without.
    for ($try = 0; $try -lt 5; $try++) {
        try {
            $stream = Open-LogStream
            try { Add-LogLine $stream $line } finally { $stream.Dispose() }
            return
        }
        catch { Start-Sleep -Milliseconds 200 }
    }
}

# Streams a command's output into the log line by line as it arrives; the
# server runs for hours, so nothing may wait for it to finish. Strings go in as
# they are, anything else through the same formatting Out-File applied.
function Write-LogOutput {
    begin { $stream = Open-LogStream }
    process {
        $lines = if ($_ -is [string]) { $_ } else { $_ | Out-String -Stream }
        foreach ($text in $lines) { Add-LogLine $stream $text }
    }
    end { $stream.Dispose() }
}

# Is whatever holds $port THIS dashboard? The same rule as dashboard-stop.ps1;
# change the two together. A port is not an identity: on Windows a server bound
# to 127.0.0.1 can share one with another program's wildcard (0.0.0.0 or ::)
# listener, and the other local dashboards are node too. A listener is this
# dashboard only when its command line runs Next.js out of this project's own
# node_modules - anchored there, since the bare project path would also match a
# sibling folder whose name merely starts with this one's.
$modules = (Join-Path $root 'node_modules') + '\'

function ConvertTo-ComparablePath([string]$Text) {
    return (($Text -replace '/', '\') -replace '\\{2,}', '\')
}

function Test-ThisDashboard([string]$CommandLine) {
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    $needle = ConvertTo-ComparablePath $modules
    return (ConvertTo-ComparablePath $CommandLine).IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-PortHolder {
    $found = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($procId in ($found.OwningProcess | Select-Object -Unique)) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        [pscustomobject]@{ Id = [int]$procId; Name = $proc.Name; Ours = Test-ThisDashboard $proc.CommandLine }
    }
}

try {
    # Already listening? Never start a second server on the port. If it is this
    # dashboard, another copy is up and there is nothing to do. If it is some
    # other program, say so - this used to log "Already running" for a port the
    # dashboard did not hold, leaving it down until the next logon with a log
    # saying it was up - and do not start beside it either: a different bind
    # address would let both listen.
    $held = @(Get-PortHolder)
    if ($held.Count -gt 0) {
        $ours = @($held | Where-Object { $_.Ours })
        if ($ours.Count -gt 0) {
            Write-Log "Already running on port $port (PID $(($ours.Id) -join ', ')) - nothing to do."
            exit 0
        }
        $others = ($held | ForEach-Object { "'$($_.Name)' PID $($_.Id)" }) -join '; '
        Write-Log "ERROR: port $port is held by another program ($others), not this dashboard. Dashboard not started."
        exit 1
    }

    # npm is npm.cmd on Windows, and a scheduled task's PATH is not an
    # interactive shell's, so resolve it explicitly rather than assuming.
    # No ?. operator here: this runs under Windows PowerShell 5.1, where that is
    # a parse error and the script dies before it can log why.
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    $npm = if ($npmCommand) { $npmCommand.Source } else { $null }
    if (-not $npm) {
        Write-Log 'ERROR: npm.cmd not found on PATH. Is Node.js installed?'
        exit 1
    }

    # A production build must EXIST. It is not rebuilt just because a source
    # file is newer -- that check used to live here and it put a full
    # `next build` in front of the server at every logon. Building belongs to
    # whoever changed the code; see docs/DESIGN.md, "Running the
    # dashboard". ensure-build.ps1 still logs a WARNING when the build is older than
    # src\, so a stale bundle is visible in this file rather than silent.
    #
    # It throws on failure, which the catch below turns into a logged ERROR.
    & (Join-Path $PSScriptRoot 'ensure-build.ps1') -LogFile $log

    # The database lives on another drive. Not fatal -- the dashboard renders an
    # empty state and the Sync page explains -- but worth recording, because a
    # missing D:\ is exactly the situation this project exists for.
    $cfgPath = Join-Path $root 'config\collector.json'
    if (Test-Path $cfgPath) {
        $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
        if (-not (Test-Path $cfg.databasePath)) {
            Write-Log "WARNING: database not found at $($cfg.databasePath). The dashboard will show an empty state."
        }
    }

    Write-Log "Starting the dashboard on port $port."
    & $npm start *>&1 | Write-LogOutput
    Write-Log "Server exited with code $LASTEXITCODE."
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
