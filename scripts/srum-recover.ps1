<#
    Soft recovery for a VSS copy of SRUDB.dat. Dot-source this; it defines
    Invoke-SrumSoftRecovery and its two helpers, and nothing else.

    A VSS copy of a live ESE database is in 'Dirty Shutdown' state, and
    SrumECmd's ESE attach REFUSES it outright -- it throws
    EsentDatabaseDirtyShutdownException instead of parsing what it can. So
    replaying the journals is not an optional nicety here: without it there is
    no CSV at all, and the collector fails with "produced no NetworkUsage CSV".

    That is a narrower claim than the one this project's notes used to make. "Do not fix
    the dirty shutdown by replaying the SRU*.log journals" was about chasing
    the last uncommitted hour, which is not worth a line of code because SRUM
    retains 30+ days. It was never about the parse itself, which depends on
    recovery and always did.

    THE CURRENT JOURNAL GENERATION IS INTERMITTENTLY LOCKED
    ------------------------------------------------------

    The rolled-over generations -- SRU07D0F.log and friends -- are opened
    share-read and copy fine, unelevated. The CURRENT one, plain SRU.log, is
    held exclusively by the SRUM service while it flushes, and a copy that
    lands in that window fails with "being used by another process".

    Missing it is fatal, and it is the one log recovery is most likely to
    need. Measured on the run that failed 2026-09-11 19:36, whose snapshot
    survived in scratch:

        Log Required: 32015-32023 (0x7d0f-0x7d17)
        copied:       0x7d0f .. 0x7d16          <- short by exactly one
        SRU.log is    lGeneration 32023 (0x7D17)

    Supplying that single file took the same database from 'Dirty Shutdown' to
    'Clean Shutdown', and SrumECmd then read 36,034 network rows out of the
    file it had produced no CSV from.

    The lock is transient, so the fix is to retry rather than to take a second
    VSS pass for a 64 KB file. Three of the ten runs before 2026-09-11 failed
    this way; all three logged the copy warning immediately beforehand.

    EXIT CODE 0 IS NOT PROOF OF A CLEAN DATABASE
    --------------------------------------------

    With SRU.chk absent, recovery starts at the oldest log present and replays
    the contiguous run it has. If the tail is missing it stops at the last
    generation it can, LEAVES THE DATABASE DIRTY, and still returns 0. That is
    why the 2026-09-06 and 2026-09-08 failures both logged "soft recovery
    ok=True" and then produced no CSV.

    So the state is read back from the header with /mh and that, not the exit
    code, is what Ok reports.

    HARD REPAIR IS THE LAST RESORT, AND IT IS SAFE HERE
    ---------------------------------------------------

    If the database is still dirty, 'esentutl /p /o' is run against it. Two
    things make that acceptable where it would not normally be:

      - It only ever touches the throwaway copy in the scratch directory. The
        live SRUM database is never passed to it. Every path below is scoped
        to $WorkDir.
      - Measured on the 2026-09-11 snapshot, repair cost nothing: journal
        replay and repair both yielded 36,034 rows. It also needs no console
        input (/o suppresses the logo, and /p does not prompt) and took 1.5s.

    Deliberately NOT copied:

      SRU.chk       the checkpoint can name a log generation Windows has since
                    deleted. Without it, recovery starts from the oldest log
                    actually present, which exists by construction.
      SRUtmp.log    ESE's scratch file for the next generation, not a record.
      SRUres*.jrs   reserve space, no records.

    The database in $WorkDir MUST be named SRUDB.dat. The log stream records
    the database by name; /d only redirects the directory it is looked up in.
#>

# Copy one journal, tolerating a writer that holds it open.
#
# [File]::ReadAllBytes asks for FileShare.Read, which fails against a writer
# holding the file without it. Requesting ReadWrite+Delete instead succeeds in
# strictly more cases -- verified against a live SRU.log. The risk it accepts
# is a torn read of the generation being written, and the cost of that is a
# log ESE rejects, which lands in the same place a missing log does: the state
# check below sees a dirty database and hard repair takes over.
function Copy-SrumJournal {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $in = [System.IO.File]::Open($Source, [System.IO.FileMode]::Open,
                                 [System.IO.FileAccess]::Read, $share)
    try {
        $out = [System.IO.File]::Create($Destination)
        try { $in.CopyTo($out) } finally { $out.Dispose() }
    } finally {
        $in.Dispose()
    }
}

# Read 'State:' out of an ESE database header. Returns the raw value, e.g.
# 'Clean Shutdown' or 'Dirty Shutdown', so a caller can log what it actually
# got rather than just a boolean.
function Get-EseShutdownState {
    param([Parameter(Mandatory = $true)][string]$Database)

    if (-not (Test-Path $Database)) { return 'missing' }

    $mh = & esentutl.exe /mh $Database 2>&1
    $hit = @($mh | Select-String -Pattern '^\s*State:\s*(.+?)\s*$') | Select-Object -First 1
    if ($hit) { return $hit.Matches[0].Groups[1].Value }
    return 'unknown'
}

function Invoke-SrumSoftRecovery {
    param(
        # Directory holding the snapshot, named SRUDB.dat. Journals are copied
        # here and every esentutl path is scoped to it, so nothing below can
        # touch the live SRUM directory.
        [Parameter(Mandatory = $true)][string]$WorkDir,

        # The live SRUM directory -- the parent of C:\...\sru\SRUDB.dat.
        [Parameter(Mandatory = $true)][string]$SrumDir,

        # The lock on SRU.log is held for a flush, not indefinitely, so a few
        # seconds of patience is the whole fix.
        [int]$CopyAttempts = 5,
        [int]$CopyDelayMs  = 1000
    )

    $warnings  = @()
    $copied    = 0
    $lastError = @{}

    $pending = @(Get-ChildItem $SrumDir -Filter 'SRU*.log' -ErrorAction SilentlyContinue |
                 Where-Object { $_.Name -ne 'SRUtmp.log' })

    for ($attempt = 1; $attempt -le $CopyAttempts -and $pending.Count -gt 0; $attempt++) {
        if ($attempt -gt 1) { Start-Sleep -Milliseconds $CopyDelayMs }

        $locked = @()
        foreach ($lg in $pending) {
            try {
                Copy-SrumJournal -Source $lg.FullName -Destination (Join-Path $WorkDir $lg.Name)
                $copied++
            } catch {
                $lastError[$lg.Name] = $_.Exception.Message
                $locked += $lg
            }
        }
        $pending = $locked
    }

    foreach ($lg in $pending) {
        $warnings += "could not copy $($lg.Name) after $CopyAttempts attempts: $($lastError[$lg.Name])"
    }

    # /r sru replays the 'sru' log stream; /i tolerates the attachment mismatch
    # a snapshot always has; /l /s /d scope log, checkpoint and database
    # lookups to $WorkDir rather than the paths recorded inside the journals.
    $out  = @(& esentutl.exe /r sru /i /l $WorkDir /s $WorkDir /d $WorkDir 2>&1)
    $code = $LASTEXITCODE

    # The exit code above is advisory. This is the answer.
    $db       = Join-Path $WorkDir 'SRUDB.dat'
    $state    = Get-EseShutdownState $db
    $repaired = $false

    if ($state -ne 'Clean Shutdown' -and (Test-Path $db)) {
        $warnings += "replay left the database '$state' (exit $code); attempting hard repair"

        # Repair writes an integrity log, SRUDB.INTEG.RAW, into the CURRENT
        # DIRECTORY rather than beside the database -- and it appends, so it
        # grows for the life of the machine. The collector's working directory
        # is the repo, so the first repair dropped a 163 KB blob of ESE output
        # into a tree whose rule is that it contains only code.
        #
        # Both locations are set because they can disagree: PowerShell's
        # Set-Location does not necessarily move the process CWD that a native
        # child inherits. Restored in finally, or every path after this point
        # resolves against scratch.
        $prevLocation = Get-Location
        $prevCwd      = [System.IO.Directory]::GetCurrentDirectory()
        try {
            Set-Location -LiteralPath $WorkDir
            [System.IO.Directory]::SetCurrentDirectory($WorkDir)
            $repairOut  = @(& esentutl.exe /p $db /o 2>&1)
            $repairCode = $LASTEXITCODE
        } finally {
            Set-Location -LiteralPath $prevLocation
            [System.IO.Directory]::SetCurrentDirectory($prevCwd)
        }
        $repaired = $true
        $out      = $out + @("--- esentutl /p (exit $repairCode) ---") + $repairOut

        # The repaired database must be left ALONE in the directory, or the
        # parse still fails -- with a different error that looks like the same
        # one. Repair resets the database's log position, so the copied stream
        # beside it is stale; SrumECmd's JetInit2 sees a stream, tries recovery
        # of its own, and throws EsentMissingLogFileException, "Current log
        # file missing", producing no CSV. Which is exactly the symptom repair
        # was invoked to fix.
        #
        # Only ever the copies in $WorkDir. The live SRUM directory is read
        # from and never written to.
        Get-ChildItem $WorkDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^(SRU.*\.log|sru\.chk|srures\d+\.jrs)$' } |
            ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
        $out = $out + @("--- log stream removed so the repaired database attaches alone ---")

        $state = Get-EseShutdownState $db
    }

    [pscustomobject]@{
        # Ok means the database is parseable, not that esentutl liked its job.
        Ok             = ($state -eq 'Clean Shutdown')
        State          = $state
        Repaired       = $repaired
        ExitCode       = $code
        LogsCopied     = $copied
        JournalsMissed = $pending.Count
        Warnings       = $warnings
        Output         = $out
    }
}
