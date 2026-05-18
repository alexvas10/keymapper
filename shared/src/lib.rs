use serde::{Deserialize, Serialize};
use rdev::Key;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub profiles: Vec<Profile>,
    pub active_profile: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Profile {
    pub name: String,
    pub mappings: Vec<Mapping>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Mapping {
    pub from: Key,
    pub to: Target,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum Target {
    Key(Key),
    Macro(Vec<MacroStep>),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MacroStep {
    pub action: MacroAction,
    pub delay_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum MacroAction {
    Press(Key),
    Release(Key),
    Tap(Key),
}
