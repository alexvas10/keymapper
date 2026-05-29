use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    #[serde(default = "default_true")]
    pub first_launch: bool,
    #[serde(default = "default_kb_size")]
    pub keyboard_size: String,
    #[serde(default = "default_kb_style")]
    pub keyboard_style: String,
    #[serde(default = "default_kb_layout")]
    pub keyboard_layout: String,
    #[serde(default)]
    pub auto_save_on_start: bool,
}

fn default_true() -> bool { true }
fn default_kb_size() -> String { "tkl".to_string() }
fn default_kb_style() -> String { "ansi".to_string() }
fn default_kb_layout() -> String { "qwerty".to_string() }

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            first_launch: true,
            keyboard_size: default_kb_size(),
            keyboard_style: default_kb_style(),
            keyboard_layout: default_kb_layout(),
            auto_save_on_start: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub profiles: Vec<Profile>,
    pub active_profile: String,
    #[serde(default)]
    pub settings: AppSettings,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Profile {
    pub name: String,
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub socd_pairs: Vec<SocdPair>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Layer {
    pub name: String,
    /// Key name (e.g. "MetaRight") that activates this layer while held.
    /// None means this is the base layer (always active).
    #[serde(default)]
    pub trigger: Option<String>,
    pub mappings: Vec<Mapping>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SocdPair {
    pub key1: String,
    pub key2: String,
    pub mode: SocdMode,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SocdMode {
    LastInputPriority,
    Neutral,
    Key1Priority,
    Key2Priority,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Mapping {
    pub from: String,
    pub to: Target,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Target {
    Key { key: String },
    Macro { steps: Vec<MacroStep> },
    ModTap {
        hold: String,
        tap: String,
        #[serde(default = "default_hold_ms")]
        hold_ms: u64,
    },
    Toggle { key: String },
    Command { cmd: String },
    Layer { name: String },
}

fn default_hold_ms() -> u64 {
    200
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MacroStep {
    pub action: MacroAction,
    #[serde(default)]
    pub delay_ms: Option<u64>,
}

// Adjacently tagged so tuple variants serialize as {"type":"press","key":"KeyA"}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", content = "key", rename_all = "lowercase")]
pub enum MacroAction {
    Press(String),
    Release(String),
    Tap(String),
}
