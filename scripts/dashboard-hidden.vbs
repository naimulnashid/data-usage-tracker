' Launches the dashboard with no window at all.
'
' This wrapper exists because there is no reliable way to start a console
' program from Task Scheduler without a window flashing up: the task's own
' "Hidden" checkbox does not suppress it, and powershell -WindowStyle Hidden
' still blinks. WScript.Shell's Run with intWindowStyle = 0 genuinely does not
' create one.
'
' Double-clicking this file also works, if you want the dashboard up before the
' next logon.

Dim shell, fso, here, ps1
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(here, "dashboard-service.ps1")

' 0 = hidden window, False = do not wait for it to finish.
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """", 0, False
