# KeyMapper Windows build script - the counterpart to build.sh.
#
# Rust's msvc target links against the Windows SDK import libraries
# (kernel32.lib, user32.lib) and needs rc.exe to embed the app manifest. Neither
# the MSVC linker nor the SDK is on PATH by default, so this shells through
# vcvars64.bat to set up the developer environment before calling cargo.
#
# Two Windows PowerShell 5.1 quirks this file works around deliberately:
#   * Keep the file pure ASCII. BOM-less .ps1 is read as ANSI, and a UTF-8 em
#     dash decodes to a trailing U+201D, which PowerShell honours as a string
#     delimiter and breaks parsing.
#   * cargo and npm write progress to stderr, which PowerShell turns into
#     NativeCommandError records. So failures are reported via `throw` and
#     explicit $LASTEXITCODE checks rather than $ErrorActionPreference='Stop'.

[CmdletBinding()]
param(
    # Build only the daemon; skip the Tauri GUI and its npm dependencies.
    [switch]$DaemonOnly,

    # Embed uiAccess="true" so the daemon can remap inside elevated windows.
    # Only useful for a signed release - Windows refuses to launch an unsigned
    # uiAccess binary. See daemon/build.rs.
    [switch]$UiAccess
)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

Write-Host "=== KeyMapper Build (Windows) ===" -ForegroundColor Cyan

# --- Locate the Visual Studio developer environment ------------------------
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    throw "vswhere.exe not found. Install Visual Studio 2022 (or Build Tools) with the 'Desktop development with C++' workload."
}

$vsRoot = & $vswhere -products * -latest -property installationPath
if (-not $vsRoot) {
    throw "No Visual Studio installation found. Install VS 2022 (or Build Tools) with the 'Desktop development with C++' workload."
}

$vcvars = Join-Path $vsRoot 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) {
    throw "vcvars64.bat not found under '$vsRoot'. The C++ tools component is missing - add it via the Visual Studio Installer."
}

# The SDK is a separate component from the MSVC compiler, and it is the one
# people forget. Fail with a useful message rather than a raw LNK1181.
if (-not (Test-Path "C:\Program Files (x86)\Windows Kits\10\Lib")) {
    throw "No Windows SDK found. Open the Visual Studio Installer -> Modify -> Individual components and add the latest 'Windows 11 SDK'."
}

Write-Host "Using toolchain: $vsRoot"

# --- Check the rest of the prerequisites -----------------------------------
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "cargo not found. Install Rust from https://rustup.rs"
}

if (-not $DaemonOnly) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm not found. Install Node.js from https://nodejs.org"
    }

    if (-not (Get-Command cargo-tauri -ErrorAction SilentlyContinue)) {
        Write-Host "Installing tauri-cli..." -ForegroundColor Yellow
        cargo install tauri-cli --version "^2"
        if ($LASTEXITCODE -ne 0) { throw "Failed to install tauri-cli." }
    }

    if (-not (Test-Path 'gui\node_modules')) {
        Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
        Push-Location gui
        try {
            npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
        }
        finally { Pop-Location }
    }
}

# --- Build ------------------------------------------------------------------
if ($UiAccess) {
    $env:KEYMAPPER_UIACCESS = '1'
    Write-Host "Building with uiAccess=true (requires a signed binary to launch)." -ForegroundColor Yellow
}
else {
    $env:KEYMAPPER_UIACCESS = '0'
}

if ($DaemonOnly) {
    $cargoArgs = 'cargo build --release -p daemon'
}
else {
    $cargoArgs = 'cargo build --release'
}

Write-Host ""
Write-Host "Building in release mode..."

# Merge cargo's stderr into stdout inside cmd, so PowerShell does not wrap
# ordinary compiler progress lines as NativeCommandError.
$cmd = '"' + $vcvars + '" >nul 2>&1 && ' + $cargoArgs + ' 2>&1'
cmd /c $cmd
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

Write-Host ""
Write-Host "=== Build complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Binaries:"
Write-Host "  target\release\keymapper-daemon.exe"
if (-not $DaemonOnly) {
    Write-Host "  target\release\keymapper-gui.exe"
}
Write-Host ""
Write-Host "To install KeyMapper (autostart at logon):"
Write-Host "  .\setup_windows.ps1"
