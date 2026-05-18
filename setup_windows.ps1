# KeyMapper Windows Setup Script
# Run this script as Administrator to install the KeyMapper Daemon as a service.

$ServiceName = "KeyMapperDaemon"
$DisplayName = "KeyMapper Daemon"
$Description = "High-performance background key remapper and macro engine."
$InstallDir = "$env:ProgramFiles\KeyMapper"
$DaemonExe = "$InstallDir\keymapper-d.exe"

# 1. Check for Administrative Privileges
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as an Administrator."
    exit
}

echo "Setting up KeyMapper for Windows..."

# 2. Create Installation Directory
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

# 3. Copy files (assuming they are built or in a release folder)
# In a real scenario, you would copy the built binaries here.
# For now, we'll just show the path.
echo "Installing to $InstallDir..."

# 4. Install the Service
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Service '$ServiceName' already exists. Updating..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Remove-Service -Name $ServiceName -Confirm:$false
}

try {
    # We use LocalSystem to ensure it has the highest privileges for input simulation.
    New-Service -Name $ServiceName `
                -BinaryPathName "`"$DaemonExe`"" `
                -DisplayName $DisplayName `
                -Description $Description `
                -StartupType Automatic
    
    Write-Host "Service '$ServiceName' installed successfully!" -ForegroundColor Green
    
    # 5. Handle Permissions (Secure Path)
    # The Program Files folder is already secure, fulfilling one of the uiAccess="true" requirements.
    
    Write-Host ""
    Write-Host "Setup complete!"
    Write-Host "NOTE: To enable 'uiAccess=true' (remapping in Admin windows like Task Manager),"
    Write-Host "the daemon executable MUST be digitally signed and installed in Program Files."
}
catch {
    Write-Error "Failed to install service: $($_.Exception.Message)"
}
