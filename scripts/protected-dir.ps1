<#
    Dot-source this. Defines Test-AdminOnlyWrite, and nothing else.

    Used on both sides of the privilege split: register-task.ps1 checks the
    directory it deploys the snapshot scripts into, and srum-snapshot.ps1 --
    the one elevated piece of this project -- refuses to run from, or clear, a
    directory that fails it.

    The rule: nothing but SYSTEM, Administrators and TrustedInstaller may
    write, delete, or change permissions or ownership, and one of those owns
    it. Anything else able to write there could swap in code or a link that
    the elevated task would then act on.

    Pure ASCII, like every .ps1 here. See docs/DESIGN.md, "PowerShell traps".
#>

function Test-AdminOnlyWrite {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path -Force

    # A junction or symlink here would redirect whatever the elevated side
    # does to wherever it points.
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { return $false }

    $trusted = @(
        'S-1-5-18',       # SYSTEM
        'S-1-5-32-544',   # BUILTIN\Administrators
        'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'  # TrustedInstaller
    )

    $acl = Get-Acl -LiteralPath $Path
    $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    if ($trusted -notcontains $owner) { return $false }

    # WriteData 0x2, AppendData 0x4, WriteEA 0x10, DeleteChild 0x40,
    # WriteAttributes 0x100, Delete 0x10000, WriteDAC 0x40000,
    # WriteOwner 0x80000, GENERIC_ALL 0x10000000, GENERIC_WRITE 0x40000000.
    # Generic bits appear on inherit-only entries and must count too.
    $writeMask = 0x500D0156

    foreach ($ace in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        if ($ace.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
        $sid = $ace.IdentityReference.Value
        # CREATOR OWNER only ever grants to whoever creates a child, and only
        # the trusted principals above can create one here.
        if ($trusted -contains $sid -or $sid -eq 'S-1-3-0') { continue }
        if ((([long]$ace.FileSystemRights) -band $writeMask) -ne 0) { return $false }
    }
    return $true
}
