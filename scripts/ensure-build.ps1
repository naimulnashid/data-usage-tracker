<#
    Makes sure there IS a production build, and stops there.

        powershell -ExecutionPolicy Bypass -File scripts\ensure-build.ps1
        powershell -ExecutionPolicy Bypass -File scripts\ensure-build.ps1 -LogFile logs\dashboard.log

    Both launchers call this: the logon task by way of dashboard-service.ps1,
    and start-data-usage-dashboard.bat directly. One answer to "is there a
    build to serve", in one place.

    WHAT IT DELIBERATELY DOES NOT DO is rebuild because a source file is newer
    than the build. That check used to live in dashboard-service.ps1, where it
    put a full `next build` in front of the server at every single logon, for a
    change that was almost always already built. Building is the job of whoever
    CHANGED THE CODE -- see docs/DESIGN.md, "Running the dashboard".

    The staleness comparison survives as a WARNING, because a served bundle
    that predates src\ is worth a line in the log even when nothing acts on it.
    That is a failure mode this project has actually hit: every file says the
    fix is in, and the running server disagrees.

    Exit 0 means there is a build to serve. Failure throws, so
    `powershell -File` exits non-zero and a caller can just test errorlevel.

    ASCII ONLY -- see the note at the top of dashboard-service.ps1.
#>

param(
    # Append everything to this file as well as writing it out. The logon task
    # runs with no console, so without this its output goes nowhere.
    [string]$LogFile
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# While the dashboard runs, its output holds logs\dashboard.log open. The
# service opens it shared (see dashboard-service.ps1), and Add-Content can
# append alongside that - but the AppendAllText probe below cannot, so a run by
# hand while the dashboard is up drops to console-only. Either way the rule is
# the same: probe once, and never let a logging error decide whether the
# dashboard starts. (The service only calls this before a server exists.)
if ($LogFile) {
    # .NET resolves a relative path against ITS OWN working directory, not the
    # shell's, so anchor it to the repo before anything touches it.
    if (-not [System.IO.Path]::IsPathRooted($LogFile)) { $LogFile = Join-Path $root $LogFile }

    # AppendAllText of nothing opens the file for writing and closes it, so the
    # lock is tested without leaving a blank line behind on every run.
    try { [System.IO.File]::AppendAllText($LogFile, '') }
    catch {
        Write-Output "NOTE: cannot write $LogFile ($($_.Exception.Message)). Continuing without it."
        $LogFile = $null
    }
}

function Say($message) {
    Write-Output $message
    if ($LogFile) {
        try {
            "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message |
                Add-Content -Path $LogFile -Encoding utf8 -ErrorAction Stop
        } catch { }
    }
}

# Runs a native command, sending its output to the log when there is one.
#
# ErrorActionPreference is dropped to Continue for the call on purpose: under
# Windows PowerShell 5.1, redirecting a native command's stderr while the
# preference is Stop turns any stderr line into a terminating NativeCommandError.
# npm writes perfectly ordinary progress there, so a successful build would
# abort on its own output.
function Invoke-Logged($exe, $arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($LogFile) { & $exe @arguments *>&1 | Add-Content -Path $LogFile -Encoding utf8 -ErrorAction SilentlyContinue }
        else { & $exe @arguments }
    } finally {
        $ErrorActionPreference = $previous
    }
}

# Two tests, not one. BUILD_ID is written at the end of a successful build, so
# its presence means the build finished -- but a .next emptied by hand, or one
# half-deleted, can leave it behind with nothing behind it. `next start` would
# then come up and fail every route.
$buildId = Join-Path $root '.next\BUILD_ID'
$serverDir = Join-Path $root '.next\server'

if ((Test-Path $buildId) -and (Test-Path $serverDir)) {
    # Warn, never act. See the header.
    $builtAt = (Get-Item $buildId).LastWriteTime
    $sources = @()
    foreach ($dir in 'src', 'config') {
        if (Test-Path $dir) {
            $sources += Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue
        }
    }
    foreach ($file in 'package.json', 'next.config.mjs', 'tsconfig.json') {
        if (Test-Path $file) { $sources += Get-Item $file }
    }
    $newest = ($sources | Measure-Object -Property LastWriteTime -Maximum).Maximum
    if (($null -ne $newest) -and ($newest -gt $builtAt)) {
        Say ("WARNING: the build is from {0}, but source changed at {1}. Serving the old build - run 'npm run build' to pick the change up." -f
            $builtAt.ToString('yyyy-MM-dd HH:mm'), $newest.ToString('yyyy-MM-dd HH:mm'))
    }
    exit 0
}

# npm is npm.cmd on Windows, and a scheduled task's PATH is not an interactive
# shell's, so resolve it explicitly rather than assuming.
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
$npm = if ($npmCommand) { $npmCommand.Source } else { $null }
if (-not $npm) { throw 'npm.cmd not found on PATH. Is Node.js installed?' }

if (-not (Test-Path 'node_modules')) {
    Say 'Installing dependencies...'
    Invoke-Logged $npm @('install')
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
}

Say 'No production build found - building. This should happen once, not at every logon.'
Invoke-Logged $npm @('run', 'build')

if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE." }
if (-not ((Test-Path $buildId) -and (Test-Path $serverDir))) {
    throw 'npm run build reported success but left no .next\BUILD_ID or .next\server.'
}

Say 'Build complete.'
exit 0
