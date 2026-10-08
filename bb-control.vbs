' BMPBGS console launcher - launch bb-control.ps1 with NO visible console window
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir_ = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dir_ & "\bb-control.ps1"""
sh.CurrentDirectory = dir_
sh.Run cmd, 0, False
