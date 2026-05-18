#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use shared::Config;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
fn get_config() -> Result<Config, String> {
    let path = PathBuf::from("config.yaml");
    if !path.exists() {
        return Err("Config file not found".to_string());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let config: Config = serde_yaml::from_str(&content).map_err(|e| e.to_string())?;
    Ok(config)
}

#[tauri::command]
fn save_config(config: Config) -> Result<(), String> {
    let path = PathBuf::from("config.yaml");
    let yaml = serde_yaml::to_string(&config).map_err(|e| e.to_string())?;
    fs::write(path, yaml).map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_config, save_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
