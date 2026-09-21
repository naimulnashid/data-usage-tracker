' Runs the network watch with no window at all.
'
' Same reason as dashboard-hidden.vbs: Task Scheduler's own "Hidden" checkbox
' does not suppress a console window, and powershell -WindowStyle Hidden still
' blinks one up. WScript.Shell's Run with intWindowStyle = 0 genuinely does not
' create one -- and the node.exe that observe-network.ps1 launches inherits that
' hidden console rather than opening its own.
'
' This one WAITS for the script to finish (unlike the dashboard launcher, which
' starts a long-running server), so the task's runtime and last result reflect
' the actual sample rather than the wrapper exiting immediately.

Dim shell, fso, here, ps1
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(here, "observe-network.ps1")

' 0 = hidden window, True = wait for it to finish.
WScript.Quit shell.Run("powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & ps1 & """", 0, True)
