# KeyMapper Windows Setup Script
#
# Installs the daemon to %LOCALAPPDATA%\KeyMapper and registers a Scheduled Task
# that starts it at logon. No administrator rights required.
#
# Why a Scheduled Task and not a Windows service: the daemon intercepts input
# with a WH_KEYBOARD_LL hook (rdev::grab). Low-level keyboard hooks are only
# delivered to a process running on the interactive desktop, and services run in
# session 0, which has no desktop. A service would start correctly and then
# never receive a single keystroke. A logon task runs inside the user's own
# session, which is what the hook requires.
#
# Keep this file pure ASCII - see the note in build_windows.ps1.

[CmdletBinding()]
param(
    # Remove the scheduled task and the installed files.
    [switch]$Uninstall,

    # Install without starting the daemon now.
    [switch]$NoStart
)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

$TaskName   = 'KeyMapperDaemon'
$InstallDir = Join-Path $env:LOCALAPPDATA 'KeyMapper'
$DaemonExe  = Join-Path $InstallDir 'keymapper-daemon.exe'
$SourceExe  = Join-Path $PSScriptRoot 'target\release\keymapper-daemon.exe'

function Stop-Daemon {
    $procs = @(Get-Process -Name 'keymapper-daemon' -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) { return }

    $procs | Stop-Process -Force -ErrorAction SilentlyContinue

    # Stop-Process returns before Windows releases the handle on the exe, so
    # wait for the processes to actually die before overwriting it.
    foreach ($p in $procs) {
        try { $null = $p.WaitForExit(5000) } catch { }
    }
}

# --- Uninstall --------------------------------------------------------------
if ($Uninstall) {
    Write-Host "Uninstalling KeyMapper..." -ForegroundColor Cyan

    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'."
    }
    else {
        Write-Host "No scheduled task '$TaskName' found."
    }

    Stop-Daemon

    if (Test-Path $InstallDir) {
        Remove-Item $InstallDir -Recurse -Force
        Write-Host "Removed $InstallDir."
    }

    Write-Host ""
    Write-Host "Uninstalled. Your config in $env:APPDATA\keymapper was left untouched." -ForegroundColor Green
    return
}

# --- Install ----------------------------------------------------------------
Write-Host "Setting up KeyMapper for Windows..." -ForegroundColor Cyan

if (-not (Test-Path $SourceExe)) {
    throw "Daemon not built. Run .\build_windows.ps1 -DaemonOnly first (expected $SourceExe)."
}

# The running daemon holds a lock on its own exe, so stop it before copying.
Stop-Daemon

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

try {
    Copy-Item $SourceExe $DaemonExe -Force -ErrorAction Stop
}
catch {
    throw "Could not write $DaemonExe : $($_.Exception.Message)"
}
Write-Host "Installed to $DaemonExe"

# --- Register the logon task ------------------------------------------------
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Task '$TaskName' already exists. Replacing..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action  = New-ScheduledTaskAction -Execute $DaemonExe
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# RunLevel stays Limited: the daemon is built with uiAccess="false" by default,
# so elevation buys nothing. See daemon/build.rs.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
                                        -LogonType Interactive `
                                        -RunLevel Limited

# A remapper must keep running: no idle timeout, no battery stop, no time limit.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
                                         -DontStopIfGoingOnBatteries `
                                         -DontStopOnIdleEnd `
                                         -ExecutionTimeLimit ([TimeSpan]::Zero) `
                                         -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName `
                       -Action $action `
                       -Trigger $trigger `
                       -Principal $principal `
                       -Settings $settings `
                       -Description 'High-performance background key remapper and macro engine.' | Out-Null

Write-Host "Registered scheduled task '$TaskName' (starts at logon)." -ForegroundColor Green

if (-not $NoStart) {
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 1
    if (Get-Process -Name 'keymapper-daemon' -ErrorAction SilentlyContinue) {
        Write-Host "Daemon started." -ForegroundColor Green
    }
    else {
        Write-Warning "Daemon did not appear to start. Run $DaemonExe directly to see the error."
    }
}

Write-Host ""
Write-Host "Setup complete!"
Write-Host "  Config:    $env:APPDATA\keymapper\config.yaml"
Write-Host "  Uninstall: .\setup_windows.ps1 -Uninstall"
Write-Host ""
Write-Host "NOTE: remapping does not apply inside elevated windows (Task Manager, UAC"
Write-Host "prompts). That needs uiAccess=true, which Windows only permits for an"
Write-Host "Authenticode-signed binary in a secure location. To build one once you have a"
Write-Host "certificate: .\build_windows.ps1 -UiAccess"
