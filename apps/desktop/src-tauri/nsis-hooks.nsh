; Hooks for the per-user NSIS installer (tauri.conf.json bundle.windows.nsis.installerHooks).
; The app registers its own logon autostart (src/autostart.rs); uninstalling removes it, along with
; the Task Manager on/off switch Windows may have stored for it.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Traccia"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Traccia"
!macroend
