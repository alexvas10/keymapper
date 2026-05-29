#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use shared::Config;
use std::fs;
use std::path::PathBuf;

// Suppress a cmd-window flash when spawning processes on Windows
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "linux")]
use std::os::unix::fs::PermissionsExt;

// WebKit's DMA-BUF renderer fails to create GBM buffers on some Wayland compositors,
// causing the window to immediately close. Disable it so the app opens correctly.
#[cfg(target_os = "linux")]
fn disable_dmabuf() {
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
}

// ---------------------------------------------------------------------------
// Config path — cross-platform via the `dirs` crate
//   Linux:   ~/.config/keymapper/config.yaml
//   Windows: %APPDATA%\keymapper\config.yaml
// ---------------------------------------------------------------------------

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("keymapper")
        .join("config.yaml")
}

// ---------------------------------------------------------------------------
// Config commands (cross-platform)
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_config() -> Result<Config, String> {
    let path = config_path();
    if !path.exists() {
        return Err("Config file not found. Install the daemon first.".to_string());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_yaml::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(config: Config) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let yaml = serde_yaml::to_string(&config).map_err(|e| e.to_string())?;
    fs::write(path, yaml).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_active_layer() -> String {
    let path = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("keymapper")
        .join("state.json");
    if !path.exists() {
        return "base".to_string();
    }
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return "base".to_string(),
    };
    serde_json::from_str::<serde_json::Value>(&content)
        .ok()
        .and_then(|v| v["layer"].as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "base".to_string())
}

// ---------------------------------------------------------------------------
// Linux daemon management (systemd user service)
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
#[tauri::command]
fn get_daemon_status() -> String {
    match std::process::Command::new("systemctl")
        .args(["--user", "is-active", "keymapper"])
        .output()
    {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => "unknown".to_string(),
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn is_daemon_installed() -> bool {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return false,
    };
    home.join(".config/systemd/user/keymapper.service").exists()
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn start_daemon() -> Result<(), String> {
    let out = std::process::Command::new("systemctl")
        .args(["--user", "start", "keymapper"])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) }
    else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn stop_daemon() -> Result<(), String> {
    let out = std::process::Command::new("systemctl")
        .args(["--user", "stop", "keymapper"])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) }
    else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn reload_daemon() -> Result<(), String> {
    let out = std::process::Command::new("systemctl")
        .args(["--user", "restart", "keymapper"])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) }
    else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn get_daemon_autostart() -> bool {
    std::process::Command::new("systemctl")
        .args(["--user", "is-enabled", "keymapper"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "enabled")
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn set_daemon_autostart(enabled: bool) -> Result<(), String> {
    let action = if enabled { "enable" } else { "disable" };
    let out = std::process::Command::new("systemctl")
        .args(["--user", action, "keymapper"])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) }
    else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn get_gui_autostart() -> bool {
    dirs::config_dir()
        .map(|d| d.join("autostart").join("keymapper-gui.desktop").exists())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn set_gui_autostart(enabled: bool) -> Result<(), String> {
    let autostart_dir = dirs::config_dir()
        .ok_or("Cannot find config dir")?
        .join("autostart");
    let path = autostart_dir.join("keymapper-gui.desktop");
    if enabled {
        fs::create_dir_all(&autostart_dir).map_err(|e| e.to_string())?;
        let bin = dirs::home_dir()
            .ok_or("Cannot find home dir")?
            .join(".local/bin/keymapper-gui");
        let content = format!(
            "[Desktop Entry]\nType=Application\nName=KeyMapper\nExec={}\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n",
            bin.display()
        );
        fs::write(path, content).map_err(|e| e.to_string())
    } else {
        if path.exists() { fs::remove_file(path).map_err(|e| e.to_string())?; }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn setup_daemon() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bin_dir = exe.parent().ok_or("Cannot find exe directory")?;
    let daemon_bin = bin_dir.join("keymapper-daemon");

    if !daemon_bin.exists() {
        return Err(format!(
            "Daemon binary not found at {}.\nRun install.sh to install both binaries.",
            daemon_bin.display()
        ));
    }

    fs::set_permissions(&daemon_bin, fs::Permissions::from_mode(0o755))
        .map_err(|e| e.to_string())?;

    let launcher = bin_dir.join("keymapper-daemon-launcher");
    let launcher_content = format!(
        "#!/bin/bash\nexec sg input -c \"sg uinput -c 'exec {}'\"",
        daemon_bin.display()
    );
    fs::write(&launcher, launcher_content).map_err(|e| e.to_string())?;
    fs::set_permissions(&launcher, fs::Permissions::from_mode(0o755))
        .map_err(|e| e.to_string())?;

    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let service_dir = home.join(".config/systemd/user");
    fs::create_dir_all(&service_dir).map_err(|e| e.to_string())?;

    let service = format!(
        "[Unit]\nDescription=KeyMapper Daemon\nAfter=graphical-session.target\n\n\
         [Service]\nExecStart={}\nRestart=always\nRestartSec=3\n\n\
         [Install]\nWantedBy=default.target\n",
        launcher.display()
    );
    fs::write(service_dir.join("keymapper.service"), &service).map_err(|e| e.to_string())?;

    std::process::Command::new("systemctl")
        .args(["--user", "daemon-reload"])
        .output()
        .map_err(|e| e.to_string())?;

    let out = std::process::Command::new("systemctl")
        .args(["--user", "enable", "--now", "keymapper"])
        .output()
        .map_err(|e| e.to_string())?;

    if out.status.success() {
        Ok("Daemon installed and started.".to_string())
    } else {
        Err(format!(
            "Service start failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

// ---------------------------------------------------------------------------
// Windows daemon management
//
// The daemon runs as a Windows Service named "KeyMapperDaemon" installed by
// setup_windows.ps1 (run once as Administrator).  Start/stop use `sc.exe`
// which does NOT require elevation once the service is already installed.
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
const WIN_SERVICE: &str = "KeyMapperDaemon";

/// Returns the daemon .exe path: next to the GUI, or in Program Files.
#[cfg(target_os = "windows")]
fn daemon_exe_path() -> Option<PathBuf> {
    let beside_gui = std::env::current_exe().ok()?
        .parent()?
        .to_path_buf()
        .join("keymapper-daemon.exe");
    if beside_gui.exists() { return Some(beside_gui); }

    let pf = PathBuf::from(
        std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into())
    ).join("KeyMapper").join("keymapper-daemon.exe");
    if pf.exists() { return Some(pf); }

    None
}

#[cfg(target_os = "windows")]
fn sc(args: &[&str]) -> std::process::Output {
    std::process::Command::new("sc")
        .args(args)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: vec![],
            stderr: vec![],
        })
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_daemon_status() -> String {
    let o = sc(&["query", WIN_SERVICE]);
    let s = String::from_utf8_lossy(&o.stdout);
    if s.contains("RUNNING")     { "active".to_string()   }
    else if s.contains("STOPPED") { "inactive".to_string() }
    else                           { "inactive".to_string() }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn is_daemon_installed() -> bool {
    let o = sc(&["query", WIN_SERVICE]);
    let s = String::from_utf8_lossy(&o.stdout);
    // Service exists when output contains STATE; absence → not installed
    s.contains("STATE") || daemon_exe_path().is_some()
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn start_daemon() -> Result<(), String> {
    // Try the service first; if not installed, spawn the process directly.
    let o = sc(&["start", WIN_SERVICE]);
    if o.status.success() { return Ok(()); }

    // Fallback: run as a detached process
    let daemon = daemon_exe_path()
        .ok_or("keymapper-daemon.exe not found. Run setup_windows.ps1 first.")?;
    std::process::Command::new(daemon)
        .creation_flags(0x00000008) // DETACHED_PROCESS
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn stop_daemon() -> Result<(), String> {
    // Try stopping the service
    let o = sc(&["stop", WIN_SERVICE]);
    if o.status.success() { return Ok(()); }

    // Fallback: taskkill
    let o = std::process::Command::new("taskkill")
        .args(["/F", "/IM", "keymapper-daemon.exe"])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;
    if o.status.success() { Ok(()) }
    else { Err(String::from_utf8_lossy(&o.stderr).trim().to_string()) }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn reload_daemon() -> Result<(), String> {
    stop_daemon()?;
    std::thread::sleep(std::time::Duration::from_millis(500));
    start_daemon()
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_daemon_autostart() -> bool {
    let o = sc(&["qc", WIN_SERVICE]);
    let s = String::from_utf8_lossy(&o.stdout);
    s.contains("AUTO_START")
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_daemon_autostart(enabled: bool) -> Result<(), String> {
    let start_type = if enabled { "auto" } else { "demand" };
    let o = sc(&["config", WIN_SERVICE, &format!("start={}", start_type)]);
    if o.status.success() { Ok(()) }
    else { Err(String::from_utf8_lossy(&o.stderr).trim().to_string()) }
}

/// Windows startup folder: %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
#[cfg(target_os = "windows")]
fn windows_startup_dir() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join("Microsoft").join("Windows")
        .join("Start Menu").join("Programs").join("Startup"))
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_gui_autostart() -> bool {
    windows_startup_dir()
        .map(|d| d.join("keymapper-gui.bat").exists())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_gui_autostart(enabled: bool) -> Result<(), String> {
    let dir = windows_startup_dir().ok_or("Cannot find Startup folder")?;
    let bat = dir.join("keymapper-gui.bat");
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(&bat, format!("@echo off\nstart \"\" \"{}\"\n", exe.display()))
            .map_err(|e| e.to_string())
    } else {
        if bat.exists() { fs::remove_file(&bat).map_err(|e| e.to_string())?; }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn setup_daemon() -> Result<String, String> {
    // On Windows the service is installed by setup_windows.ps1 (requires Admin).
    // This command just verifies the binary is present and guides the user.
    match daemon_exe_path() {
        Some(p) => Ok(format!(
            "Daemon found at {}.\n\
             To install as a Windows Service (recommended), run setup_windows.ps1 as Administrator.\n\
             You can also use Start/Stop here to run it as a background process without admin rights.",
            p.display()
        )),
        None => Err(
            "keymapper-daemon.exe not found next to this app or in Program Files\\KeyMapper.\n\
             Download it from the Releases page and place it beside keymapper-gui.exe, \
             or run setup_windows.ps1 as Administrator.".to_string()
        ),
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    #[cfg(target_os = "linux")]
    disable_dmabuf();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_daemon_status,
            is_daemon_installed,
            start_daemon,
            stop_daemon,
            setup_daemon,
            reload_daemon,
            get_daemon_autostart,
            set_daemon_autostart,
            get_gui_autostart,
            set_gui_autostart,
            get_active_layer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
