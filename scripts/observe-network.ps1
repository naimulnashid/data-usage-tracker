<#
    Samples the current network and hands it to observe-network.mjs.

    Runs every 15 minutes from the "Data Usage Network Watch" task, unelevated.
    See the header of observe-network.mjs for why this is separate from the
    daily collector.

    ASCII ONLY -- see the note at the top of dashboard-service.ps1.
#>

$ErrorActionPreference = 'Stop'

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot }
             elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path }
             else { $null }
if (-not $scriptDir) { exit 1 }

$root = (Resolve-Path (Join-Path $scriptDir '..')).Path
Set-Location $root

# Resolve node explicitly: a scheduled task's PATH is not an interactive
# shell's, and a bare command name works when tested and fails at 03:15.
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
$node = if ($nodeCmd) { $nodeCmd.Source } else { "$env:ProgramFiles\nodejs\node.exe" }
if (-not (Test-Path $node)) { exit 1 }

# Exactly one active connection, or the pairing is ambiguous and recording a
# guess would be worse than recording nothing.
$conns = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)
if ($conns.Count -ne 1) { exit 0 }

& $node (Join-Path $root 'scripts\observe-network.mjs') `
    --name $conns[0].Name --interface $conns[0].InterfaceAlias | Out-Null
