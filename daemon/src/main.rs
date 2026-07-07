use shared::{Config, MacroAction, SocdMode, Target};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use notify::{RecursiveMode, Watcher, Config as NotifyConfig};
use anyhow::Context;

// ---------------------------------------------------------------------------
// Platform-agnostic DaemonEvent
// All platform backends convert raw key events into this type before sending
// to the shared processing loop.
// ---------------------------------------------------------------------------

/// Identity of a physical input device, used to route events to a profile.
/// `id` is "vendor:product" in lowercase hex (e.g. "feed:6060" for many QMK
/// boards); `name` is the kernel-reported device name.
struct DevId {
    name: String,
    id: String,
}

enum DaemonEvent {
    Key { dev: Arc<DevId>, key: String, press: bool },
    HoldTimerFired { profile: String, key: String },
    /// Inject directly to output, bypassing AppState (used by macro steps).
    InjectDirect(String, bool),
}

// ---------------------------------------------------------------------------
// Per-key mod-tap runtime state
// ---------------------------------------------------------------------------

struct ModTapState {
    hold_key: String,
    tap_key: String,
    hold_ms: u64,
    in_hold_mode: bool,
    cancel_tx: Option<oneshot::Sender<()>>,
}

// ---------------------------------------------------------------------------
// SOCD effective state
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum SocdEff { Neither, Key1, Key2 }

// ---------------------------------------------------------------------------
// AppState — entirely platform-agnostic, holds the runtime state for ONE
// profile. on_press / on_release / on_hold_timer return Vec<(String, bool)>:
//   (key_name, is_press)  to be injected by the platform layer.
// ---------------------------------------------------------------------------

struct AppState {
    config: Config,
    active_profile_name: String,

    base_mappings: HashMap<String, Target>,
    layer_mappings: Vec<HashMap<String, Target>>,
    layer_triggers: HashMap<String, usize>,

    mod_tap: HashMap<String, ModTapState>,
    toggle: HashMap<String, String>,
    socd_phys: Vec<(bool, bool)>,
    socd_eff: Vec<SocdEff>,
    layer_held: HashSet<String>,
    layer_mapping_held: HashSet<String>,
    layer_mapping_idx: HashMap<String, usize>,

    pub active_display_layer: String,
}

impl AppState {
    fn new(config: Config, profile_name: String) -> Self {
        let mut s = Self {
            active_profile_name: profile_name,
            base_mappings: HashMap::new(),
            layer_mappings: vec![],
            layer_triggers: HashMap::new(),
            mod_tap: HashMap::new(),
            toggle: HashMap::new(),
            socd_phys: vec![],
            socd_eff: vec![],
            layer_held: HashSet::new(),
            layer_mapping_held: HashSet::new(),
            layer_mapping_idx: HashMap::new(),
            active_display_layer: "base".to_string(),
            config,
        };
        s.rebuild();
        s
    }

    fn rebuild(&mut self) {
        self.base_mappings.clear();
        self.layer_mappings.clear();
        self.layer_triggers.clear();
        self.layer_mapping_held.clear();
        self.layer_mapping_idx.clear();
        self.active_display_layer = "base".to_string();

        let profile = self.config.profiles.iter()
            .find(|p| p.name == self.active_profile_name)
            .or_else(|| self.config.profiles.first());

        if let Some(profile) = profile {
            let n = profile.socd_pairs.len();
            self.socd_phys = vec![(false, false); n];
            self.socd_eff = vec![SocdEff::Neither; n];

            for (idx, layer) in profile.layers.iter().enumerate() {
                let mappings: HashMap<_, _> = layer.mappings.iter()
                    .map(|m| (m.from.clone(), m.to.clone()))
                    .collect();
                if layer.trigger.is_none() {
                    self.base_mappings = mappings.clone();
                }
                if let Some(trigger) = &layer.trigger {
                    self.layer_triggers.insert(trigger.clone(), idx);
                }
                self.layer_mappings.push(mappings);
            }
        }
    }

    fn get_mapping(&self, key: &str) -> Option<&Target> {
        for trigger in &self.layer_held {
            let idx = self.layer_triggers.get(trigger)
                .or_else(|| self.layer_mapping_idx.get(trigger));
            if let Some(&idx) = idx {
                if let Some(t) = self.layer_mappings.get(idx).and_then(|m| m.get(key)) {
                    return Some(t);
                }
            }
        }
        self.base_mappings.get(key)
    }

    fn find_layer_idx(&self, name: &str) -> Option<usize> {
        let profile = self.config.profiles.iter()
            .find(|p| p.name == self.active_profile_name)?;
        profile.layers.iter().position(|l| l.name == name)
    }

    fn layer_name_by_idx(&self, idx: usize) -> Option<String> {
        let profile = self.config.profiles.iter()
            .find(|p| p.name == self.active_profile_name)?;
        profile.layers.get(idx).map(|l| l.name.clone())
    }

    fn on_press(&mut self, key: &str, tx: &mpsc::Sender<DaemonEvent>) -> Vec<(String, bool)> {
        let mut out: Vec<(String, bool)> = vec![];

        // Layer trigger (trigger-field)?
        if self.layer_triggers.contains_key(key) {
            self.layer_held.insert(key.to_owned());
            if let Some(&idx) = self.layer_triggers.get(key) {
                if let Some(name) = self.layer_name_by_idx(idx) {
                    self.active_display_layer = name;
                }
            }
            return vec![];
        }

        // SOCD?
        if let Some(events) = self.handle_socd_press(key) {
            return events;
        }

        // Activate hold mode for any pending mod-tap on other-key press
        let pending: Vec<String> = self.mod_tap.iter()
            .filter(|(_, s)| !s.in_hold_mode)
            .map(|(k, _)| k.clone())
            .collect();
        for mt_key in pending {
            if let Some(state) = self.mod_tap.get_mut(&mt_key) {
                state.in_hold_mode = true;
                if let Some(cancel) = state.cancel_tx.take() { let _ = cancel.send(()); }
                out.push((state.hold_key.clone(), true));
            }
        }

        let target = self.get_mapping(key).cloned();
        match target {
            None => out.push((key.to_owned(), true)),
            Some(Target::Key { key: tk }) => out.push((tk, true)),
            Some(Target::ModTap { hold, tap, hold_ms }) => {
                let (cancel_tx, cancel_rx) = oneshot::channel();
                self.mod_tap.insert(key.to_owned(), ModTapState {
                    hold_key: hold,
                    tap_key: tap,
                    hold_ms,
                    in_hold_mode: false,
                    cancel_tx: Some(cancel_tx),
                });
                let key_owned = key.to_owned();
                let profile = self.active_profile_name.clone();
                let tx2 = tx.clone();
                tokio::spawn(async move {
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(hold_ms)) => {
                            let _ = tx2.send(DaemonEvent::HoldTimerFired { profile, key: key_owned }).await;
                        }
                        _ = cancel_rx => {}
                    }
                });
            }
            Some(Target::Toggle { key: tk }) => {
                if self.toggle.remove(key).is_some() {
                    out.push((tk, false));
                } else {
                    self.toggle.insert(key.to_owned(), tk.clone());
                    out.push((tk, true));
                }
            }
            Some(Target::Command { cmd }) => {
                tokio::spawn(async move {
                    let _ = tokio::process::Command::new("sh").arg("-c").arg(&cmd).spawn();
                });
            }
            Some(Target::Layer { name }) => {
                if let Some(idx) = self.find_layer_idx(&name) {
                    self.layer_held.insert(key.to_owned());
                    self.layer_mapping_held.insert(key.to_owned());
                    self.layer_mapping_idx.insert(key.to_owned(), idx);
                    self.active_display_layer = name;
                }
            }
            Some(Target::Macro { steps }) => {
                let tx2 = tx.clone();
                tokio::spawn(async move {
                    for step in steps {
                        let pairs: Vec<(String, bool)> = match &step.action {
                            MacroAction::Press(k)   => vec![(k.clone(), true)],
                            MacroAction::Release(k) => vec![(k.clone(), false)],
                            MacroAction::Tap(k)     => vec![(k.clone(), true), (k.clone(), false)],
                        };
                        for (k, p) in pairs {
                            let _ = tx2.send(DaemonEvent::InjectDirect(k, p)).await;
                        }
                        if let Some(delay) = step.delay_ms {
                            tokio::time::sleep(Duration::from_millis(delay)).await;
                        }
                    }
                });
            }
        }
        out
    }

    fn on_release(&mut self, key: &str) -> Vec<(String, bool)> {
        let mut out: Vec<(String, bool)> = vec![];

        // Layer trigger (trigger-field)?
        if self.layer_triggers.contains_key(key) {
            self.layer_held.remove(key);
            if self.layer_held.is_empty() {
                self.active_display_layer = "base".to_string();
            }
            return vec![];
        }
        // Layer trigger (mapping-based)?
        if self.layer_mapping_held.contains(key) {
            self.layer_held.remove(key);
            self.layer_mapping_held.remove(key);
            self.layer_mapping_idx.remove(key);
            if self.layer_held.is_empty() {
                self.active_display_layer = "base".to_string();
            }
            return vec![];
        }

        // SOCD?
        if let Some(events) = self.handle_socd_release(key) {
            return events;
        }

        // Mod-tap?
        if let Some(state) = self.mod_tap.remove(key) {
            if state.in_hold_mode {
                out.push((state.hold_key, false));
            } else {
                if let Some(cancel) = state.cancel_tx { let _ = cancel.send(()); }
                out.push((state.tap_key.clone(), true));
                out.push((state.tap_key, false));
            }
            return out;
        }

        // Toggle? Suppress the from-key release; target stays held.
        if self.toggle.contains_key(key) { return vec![]; }

        let target = self.get_mapping(key).cloned();
        match target {
            None                          => out.push((key.to_owned(), false)),
            Some(Target::Key { key: tk }) => out.push((tk, false)),
            _                             => {}
        }
        out
    }

    fn on_hold_timer(&mut self, key: &str) -> Vec<(String, bool)> {
        if let Some(state) = self.mod_tap.get_mut(key) {
            if !state.in_hold_mode {
                state.in_hold_mode = true;
                return vec![(state.hold_key.clone(), true)];
            }
        }
        vec![]
    }

    // -----------------------------------------------------------------------
    // SOCD helpers
    // -----------------------------------------------------------------------

    fn handle_socd_press(&mut self, key: &str) -> Option<Vec<(String, bool)>> {
        let pairs: Vec<_> = {
            let profile = self.config.profiles.iter()
                .find(|p| p.name == self.active_profile_name)?;
            profile.socd_pairs.iter().enumerate()
                .filter(|(_, p)| p.key1 == key || p.key2 == key)
                .map(|(i, p)| (i, p.key1.clone(), p.key2.clone(), p.mode.clone()))
                .collect()
        };
        if pairs.is_empty() { return None; }
        let mut out = vec![];
        for (i, key1, key2, mode) in pairs {
            let is_key1 = key1 == key;
            if is_key1 {
                self.socd_phys[i].0 = true;
                let (other_phys, eff) = (self.socd_phys[i].1, self.socd_eff[i]);
                out.extend(socd_press(i, true, other_phys, eff, &key1, &key2, &mode, &mut self.socd_eff));
            } else {
                self.socd_phys[i].1 = true;
                let (other_phys, eff) = (self.socd_phys[i].0, self.socd_eff[i]);
                out.extend(socd_press(i, false, other_phys, eff, &key2, &key1, &mode, &mut self.socd_eff));
            }
        }
        Some(out)
    }

    fn handle_socd_release(&mut self, key: &str) -> Option<Vec<(String, bool)>> {
        let pairs: Vec<_> = {
            let profile = self.config.profiles.iter()
                .find(|p| p.name == self.active_profile_name)?;
            profile.socd_pairs.iter().enumerate()
                .filter(|(_, p)| p.key1 == key || p.key2 == key)
                .map(|(i, p)| (i, p.key1.clone(), p.key2.clone(), p.mode.clone()))
                .collect()
        };
        if pairs.is_empty() { return None; }
        let mut out = vec![];
        for (i, key1, key2, _mode) in pairs {
            let is_key1 = key1 == key;
            if is_key1 {
                self.socd_phys[i].0 = false;
                let (other_phys, eff) = (self.socd_phys[i].1, self.socd_eff[i]);
                out.extend(socd_release(i, true, other_phys, eff, &key1, &key2, &mut self.socd_eff));
            } else {
                self.socd_phys[i].1 = false;
                let (other_phys, eff) = (self.socd_phys[i].0, self.socd_eff[i]);
                out.extend(socd_release(i, false, other_phys, eff, &key2, &key1, &mut self.socd_eff));
            }
        }
        Some(out)
    }
}

// ---------------------------------------------------------------------------
// SOCD resolution (free functions to avoid borrow issues)
// ---------------------------------------------------------------------------

fn socd_press(
    pair_idx: usize, is_key1: bool, other_phys: bool, current_eff: SocdEff,
    pressed_key: &str, other_key: &str, mode: &SocdMode, socd_eff: &mut Vec<SocdEff>,
) -> Vec<(String, bool)> {
    let new_eff = if is_key1 { SocdEff::Key1 } else { SocdEff::Key2 };
    let mut out = vec![];
    if !other_phys {
        out.push((pressed_key.to_owned(), true));
        socd_eff[pair_idx] = new_eff;
        return out;
    }
    match mode {
        SocdMode::LastInputPriority => {
            if current_eff != SocdEff::Neither { out.push((other_key.to_owned(), false)); }
            out.push((pressed_key.to_owned(), true));
            socd_eff[pair_idx] = new_eff;
        }
        SocdMode::Neutral => {
            if current_eff != SocdEff::Neither { out.push((other_key.to_owned(), false)); }
            socd_eff[pair_idx] = SocdEff::Neither;
        }
        SocdMode::Key1Priority => {
            if is_key1 {
                if current_eff == SocdEff::Key2 { out.push((other_key.to_owned(), false)); }
                out.push((pressed_key.to_owned(), true));
                socd_eff[pair_idx] = SocdEff::Key1;
            }
        }
        SocdMode::Key2Priority => {
            if !is_key1 {
                if current_eff == SocdEff::Key1 { out.push((other_key.to_owned(), false)); }
                out.push((pressed_key.to_owned(), true));
                socd_eff[pair_idx] = SocdEff::Key2;
            }
        }
    }
    out
}

fn socd_release(
    pair_idx: usize, is_key1: bool, other_phys: bool, current_eff: SocdEff,
    released_key: &str, other_key: &str, socd_eff: &mut Vec<SocdEff>,
) -> Vec<(String, bool)> {
    let my_eff    = if is_key1 { SocdEff::Key1 } else { SocdEff::Key2 };
    let other_eff = if is_key1 { SocdEff::Key2 } else { SocdEff::Key1 };
    let mut out = vec![];
    if current_eff == my_eff {
        out.push((released_key.to_owned(), false));
        if other_phys {
            out.push((other_key.to_owned(), true));
            socd_eff[pair_idx] = other_eff;
        } else {
            socd_eff[pair_idx] = SocdEff::Neither;
        }
    } else if current_eff == SocdEff::Neither && other_phys {
        out.push((other_key.to_owned(), true));
        socd_eff[pair_idx] = other_eff;
    } else {
        if !other_phys { socd_eff[pair_idx] = SocdEff::Neither; }
    }
    out
}

// ---------------------------------------------------------------------------
// Engine — routes device events to per-profile AppStates.
//
// A profile with `device: Some(matcher)` is applied to keyboards whose
// "vendor:product" id equals the matcher, or whose name contains it
// (case-insensitive). This is how bindings are saved for a specific board
// (e.g. a QMK keyboard) independently of the global active profile.
// Devices not matched by any profile use `active_profile`.
// ---------------------------------------------------------------------------

struct Engine {
    config: Config,
    states: HashMap<String, AppState>,
}

impl Engine {
    fn new(config: Config) -> Self {
        let mut e = Engine { config: Config { profiles: vec![], active_profile: String::new(), settings: config.settings.clone() }, states: HashMap::new() };
        e.update_config(config);
        e
    }

    fn update_config(&mut self, config: Config) {
        self.states = config.profiles.iter()
            .map(|p| (p.name.clone(), AppState::new(config.clone(), p.name.clone())))
            .collect();
        self.config = config;
        println!("Config loaded. Active profile: {} ({} profile state(s))",
            self.config.active_profile, self.states.len());
    }

    fn profile_for_device(&self, dev: &DevId) -> String {
        let name_lc = dev.name.to_lowercase();
        self.config.profiles.iter()
            .find(|p| p.device.as_deref().map_or(false, |m| {
                let m = m.trim();
                !m.is_empty() && (m.eq_ignore_ascii_case(&dev.id) || name_lc.contains(&m.to_lowercase()))
            }))
            .map(|p| p.name.clone())
            .unwrap_or_else(|| self.config.active_profile.clone())
    }

    fn state_for(&mut self, profile: &str) -> Option<&mut AppState> {
        if self.states.contains_key(profile) {
            self.states.get_mut(profile)
        } else {
            // Fallback: active profile, then any profile.
            let active = self.config.active_profile.clone();
            if self.states.contains_key(&active) {
                self.states.get_mut(&active)
            } else {
                self.states.values_mut().next()
            }
        }
    }

    /// Process one routed event; returns (events_to_inject, display_layer).
    fn handle(&mut self, event: DaemonEvent, tx: &mpsc::Sender<DaemonEvent>) -> (Vec<(String, bool)>, String) {
        match event {
            DaemonEvent::InjectDirect(key, pressed) => {
                let layer = self.state_for("").map(|s| s.active_display_layer.clone())
                    .unwrap_or_else(|| "base".to_string());
                (vec![(key, pressed)], layer)
            }
            DaemonEvent::Key { dev, key, press } => {
                let profile = self.profile_for_device(&dev);
                let tx = tx.clone();
                match self.state_for(&profile) {
                    Some(s) => {
                        let out = if press { s.on_press(&key, &tx) } else { s.on_release(&key) };
                        (out, s.active_display_layer.clone())
                    }
                    // No profiles at all: pass through untouched.
                    None => (vec![(key, press)], "base".to_string()),
                }
            }
            DaemonEvent::HoldTimerFired { profile, key } => {
                match self.state_for(&profile) {
                    Some(s) => (s.on_hold_timer(&key), s.active_display_layer.clone()),
                    None => (vec![], "base".to_string()),
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Config + state file paths
// ---------------------------------------------------------------------------

fn config_path() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
        .join("keymapper").join("config.yaml")
}

fn state_path() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
        .join("keymapper").join("state.json")
}

fn load_config(path: &std::path::Path) -> anyhow::Result<Config> {
    let content = std::fs::read_to_string(path).context("read config")?;
    serde_yaml::from_str(&content).context("parse config")
}

fn write_state(layer_name: &str) {
    let path = state_path();
    if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
    let _ = std::fs::write(&path, format!("{{\"layer\":\"{}\"}}", layer_name));
}

// ---------------------------------------------------------------------------
// Linux: evdev grab  +  uinput virtual keyboard
//
// Works on X11, Wayland, and raw VTs — no display-server dependency.
// Physical keyboards are grabbed at the kernel level (EVIOCGRAB). The
// compositor/X server never sees the raw events; it only sees what we emit
// through the uinput virtual device.
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use evdev::{AttributeSet, Device, EventType, InputEvent, Key as EKey};
    use evdev::uinput::VirtualDeviceBuilder;

    // ------------------------------------------------------------------
    // Key name ↔ evdev key code  (same string names used in the config)
    // ------------------------------------------------------------------

    // name → evdev key: returns the constant directly (no glob import needed)
    pub fn name_to_key(name: &str) -> Option<EKey> {
        Some(match name {
            "KeyA"=>EKey::KEY_A,"KeyB"=>EKey::KEY_B,"KeyC"=>EKey::KEY_C,"KeyD"=>EKey::KEY_D,
            "KeyE"=>EKey::KEY_E,"KeyF"=>EKey::KEY_F,"KeyG"=>EKey::KEY_G,"KeyH"=>EKey::KEY_H,
            "KeyI"=>EKey::KEY_I,"KeyJ"=>EKey::KEY_J,"KeyK"=>EKey::KEY_K,"KeyL"=>EKey::KEY_L,
            "KeyM"=>EKey::KEY_M,"KeyN"=>EKey::KEY_N,"KeyO"=>EKey::KEY_O,"KeyP"=>EKey::KEY_P,
            "KeyQ"=>EKey::KEY_Q,"KeyR"=>EKey::KEY_R,"KeyS"=>EKey::KEY_S,"KeyT"=>EKey::KEY_T,
            "KeyU"=>EKey::KEY_U,"KeyV"=>EKey::KEY_V,"KeyW"=>EKey::KEY_W,"KeyX"=>EKey::KEY_X,
            "KeyY"=>EKey::KEY_Y,"KeyZ"=>EKey::KEY_Z,
            "Num0"=>EKey::KEY_0,"Num1"=>EKey::KEY_1,"Num2"=>EKey::KEY_2,"Num3"=>EKey::KEY_3,
            "Num4"=>EKey::KEY_4,"Num5"=>EKey::KEY_5,"Num6"=>EKey::KEY_6,"Num7"=>EKey::KEY_7,
            "Num8"=>EKey::KEY_8,"Num9"=>EKey::KEY_9,
            "F1"=>EKey::KEY_F1,"F2"=>EKey::KEY_F2,"F3"=>EKey::KEY_F3,"F4"=>EKey::KEY_F4,
            "F5"=>EKey::KEY_F5,"F6"=>EKey::KEY_F6,"F7"=>EKey::KEY_F7,"F8"=>EKey::KEY_F8,
            "F9"=>EKey::KEY_F9,"F10"=>EKey::KEY_F10,"F11"=>EKey::KEY_F11,"F12"=>EKey::KEY_F12,
            "F13"=>EKey::KEY_F13,"F14"=>EKey::KEY_F14,"F15"=>EKey::KEY_F15,"F16"=>EKey::KEY_F16,
            "F17"=>EKey::KEY_F17,"F18"=>EKey::KEY_F18,"F19"=>EKey::KEY_F19,"F20"=>EKey::KEY_F20,
            "F21"=>EKey::KEY_F21,"F22"=>EKey::KEY_F22,"F23"=>EKey::KEY_F23,"F24"=>EKey::KEY_F24,
            "ShiftLeft"=>EKey::KEY_LEFTSHIFT,"ShiftRight"=>EKey::KEY_RIGHTSHIFT,
            "ControlLeft"=>EKey::KEY_LEFTCTRL,"ControlRight"=>EKey::KEY_RIGHTCTRL,
            "Alt"=>EKey::KEY_LEFTALT,"AltGr"=>EKey::KEY_RIGHTALT,
            "MetaLeft"=>EKey::KEY_LEFTMETA,"MetaRight"=>EKey::KEY_RIGHTMETA,
            "CapsLock"=>EKey::KEY_CAPSLOCK,
            "Return"=>EKey::KEY_ENTER,"Backspace"=>EKey::KEY_BACKSPACE,
            "Tab"=>EKey::KEY_TAB,"Space"=>EKey::KEY_SPACE,"Escape"=>EKey::KEY_ESC,
            "UpArrow"=>EKey::KEY_UP,"DownArrow"=>EKey::KEY_DOWN,
            "LeftArrow"=>EKey::KEY_LEFT,"RightArrow"=>EKey::KEY_RIGHT,
            "Home"=>EKey::KEY_HOME,"End"=>EKey::KEY_END,
            "PageUp"=>EKey::KEY_PAGEUP,"PageDown"=>EKey::KEY_PAGEDOWN,
            "Insert"=>EKey::KEY_INSERT,"Delete"=>EKey::KEY_DELETE,
            "PrintScreen"=>EKey::KEY_SYSRQ,"ScrollLock"=>EKey::KEY_SCROLLLOCK,
            "Pause"=>EKey::KEY_PAUSE,"NumLock"=>EKey::KEY_NUMLOCK,
            "BackQuote"=>EKey::KEY_GRAVE,"Minus"=>EKey::KEY_MINUS,"Equal"=>EKey::KEY_EQUAL,
            "LeftBracket"=>EKey::KEY_LEFTBRACE,"RightBracket"=>EKey::KEY_RIGHTBRACE,
            "BackSlash"=>EKey::KEY_BACKSLASH,"SemiColon"=>EKey::KEY_SEMICOLON,
            "Quote"=>EKey::KEY_APOSTROPHE,"Comma"=>EKey::KEY_COMMA,
            "Dot"=>EKey::KEY_DOT,"Slash"=>EKey::KEY_SLASH,
            "IntlBackslash"=>EKey::KEY_102ND,
            "Kp0"=>EKey::KEY_KP0,"Kp1"=>EKey::KEY_KP1,"Kp2"=>EKey::KEY_KP2,
            "Kp3"=>EKey::KEY_KP3,"Kp4"=>EKey::KEY_KP4,"Kp5"=>EKey::KEY_KP5,
            "Kp6"=>EKey::KEY_KP6,"Kp7"=>EKey::KEY_KP7,"Kp8"=>EKey::KEY_KP8,
            "Kp9"=>EKey::KEY_KP9,
            "KpPlus"=>EKey::KEY_KPPLUS,"KpMinus"=>EKey::KEY_KPMINUS,
            "KpMultiply"=>EKey::KEY_KPASTERISK,"KpDivide"=>EKey::KEY_KPSLASH,
            "KpReturn"=>EKey::KEY_KPENTER,"KpDelete"=>EKey::KEY_KPDOT,
            "VolumeUp"=>EKey::KEY_VOLUMEUP,"VolumeDown"=>EKey::KEY_VOLUMEDOWN,
            "VolumeMute"=>EKey::KEY_MUTE,
            "PlayPause"=>EKey::KEY_PLAYPAUSE,"MediaStop"=>EKey::KEY_STOPCD,
            "MediaNext"=>EKey::KEY_NEXTSONG,"MediaPrevious"=>EKey::KEY_PREVIOUSSONG,
            "Menu"=>EKey::KEY_COMPOSE,
            "BrightnessUp"=>EKey::KEY_BRIGHTNESSUP,"BrightnessDown"=>EKey::KEY_BRIGHTNESSDOWN,
            "Calculator"=>EKey::KEY_CALC,"Mail"=>EKey::KEY_MAIL,
            "WWWHome"=>EKey::KEY_HOMEPAGE,"WWWSearch"=>EKey::KEY_SEARCH,
            "Eject"=>EKey::KEY_EJECTCD,"Sleep"=>EKey::KEY_SLEEP,
            // Fallback for any other evdev code (QMK boards can emit codes we
            // have no friendly name for): "Raw<code>" round-trips through the
            // config unchanged.
            _ => {
                if let Some(code) = name.strip_prefix("Raw").and_then(|c| c.parse::<u16>().ok()) {
                    return Some(EKey::new(code));
                }
                return None;
            }
        })
    }

    // evdev key → name: Key is a newtype Key(u16); match on the raw code.
    // These are Linux kernel input event codes (stable ABI, unchanged since 2.x).
    pub fn key_to_name(key: EKey) -> Option<&'static str> {
        Some(match key.0 {
            30=>"KeyA",48=>"KeyB",46=>"KeyC",32=>"KeyD",18=>"KeyE",
            33=>"KeyF",34=>"KeyG",35=>"KeyH",23=>"KeyI",36=>"KeyJ",
            37=>"KeyK",38=>"KeyL",50=>"KeyM",49=>"KeyN",24=>"KeyO",
            25=>"KeyP",16=>"KeyQ",19=>"KeyR",31=>"KeyS",20=>"KeyT",
            22=>"KeyU",47=>"KeyV",17=>"KeyW",45=>"KeyX",21=>"KeyY",44=>"KeyZ",
            11=>"Num0",2=>"Num1",3=>"Num2",4=>"Num3",5=>"Num4",
            6=>"Num5",7=>"Num6",8=>"Num7",9=>"Num8",10=>"Num9",
            59=>"F1",60=>"F2",61=>"F3",62=>"F4",63=>"F5",64=>"F6",
            65=>"F7",66=>"F8",67=>"F9",68=>"F10",87=>"F11",88=>"F12",
            183=>"F13",184=>"F14",185=>"F15",186=>"F16",
            187=>"F17",188=>"F18",189=>"F19",190=>"F20",
            191=>"F21",192=>"F22",193=>"F23",194=>"F24",
            42=>"ShiftLeft",54=>"ShiftRight",
            29=>"ControlLeft",97=>"ControlRight",
            56=>"Alt",100=>"AltGr",125=>"MetaLeft",126=>"MetaRight",
            58=>"CapsLock",
            28=>"Return",14=>"Backspace",15=>"Tab",57=>"Space",1=>"Escape",
            103=>"UpArrow",108=>"DownArrow",105=>"LeftArrow",106=>"RightArrow",
            102=>"Home",107=>"End",104=>"PageUp",109=>"PageDown",
            110=>"Insert",111=>"Delete",
            99=>"PrintScreen",70=>"ScrollLock",119=>"Pause",69=>"NumLock",
            41=>"BackQuote",12=>"Minus",13=>"Equal",
            26=>"LeftBracket",27=>"RightBracket",43=>"BackSlash",
            39=>"SemiColon",40=>"Quote",51=>"Comma",52=>"Dot",53=>"Slash",
            86=>"IntlBackslash",
            82=>"Kp0",79=>"Kp1",80=>"Kp2",81=>"Kp3",75=>"Kp4",
            76=>"Kp5",77=>"Kp6",71=>"Kp7",72=>"Kp8",73=>"Kp9",
            78=>"KpPlus",74=>"KpMinus",55=>"KpMultiply",98=>"KpDivide",
            96=>"KpReturn",83=>"KpDelete",
            115=>"VolumeUp",114=>"VolumeDown",113=>"VolumeMute",
            164=>"PlayPause",166=>"MediaStop",163=>"MediaNext",165=>"MediaPrevious",
            127=>"Menu",225=>"BrightnessUp",224=>"BrightnessDown",
            140=>"Calculator",155=>"Mail",172=>"WWWHome",217=>"WWWSearch",
            161=>"Eject",142=>"Sleep",
            _ => return None,
        })
    }

    /// Name for any evdev code — falls back to "Raw<code>" so keys we have no
    /// friendly name for are still remappable and pass through instead of
    /// being swallowed by the exclusive grab.
    pub fn code_to_name(code: u16) -> String {
        key_to_name(EKey::new(code))
            .map(|s| s.to_owned())
            .unwrap_or_else(|| format!("Raw{code}"))
    }

    // ------------------------------------------------------------------
    // Find all keyboard devices in /dev/input/
    // A device is considered a keyboard if it reports KEY_SPACE.
    // Our own uinput device (and any other "KeyMapper" virtual device) is
    // excluded so we never grab our own output and feed back into ourselves.
    // ------------------------------------------------------------------

    const VIRT_NAME: &str = "KeyMapper";

    fn is_keyboard(d: &Device) -> bool {
        d.name().map_or(true, |n| n != VIRT_NAME)
            && d.supported_keys().map_or(false, |keys| keys.contains(EKey::KEY_SPACE))
    }

    fn find_keyboards() -> Vec<(PathBuf, Device)> {
        evdev::enumerate().filter(|(_, d)| is_keyboard(d)).collect()
    }

    fn dev_id(d: &Device) -> Arc<DevId> {
        let id = d.input_id();
        Arc::new(DevId {
            name: d.name().unwrap_or("unknown").to_owned(),
            id: format!("{:04x}:{:04x}", id.vendor(), id.product()),
        })
    }

    // ------------------------------------------------------------------
    // Create uinput virtual keyboard with all keys we might output
    // ------------------------------------------------------------------

    fn create_virtual_device() -> anyhow::Result<evdev::uinput::VirtualDevice> {
        // Register the full kernel key range (1..=0x2e7) so anything a
        // physical board can send — including QMK media/system keys and
        // codes we have no friendly name for — can be re-emitted.
        let mut keys: AttributeSet<EKey> = AttributeSet::new();
        for code in 1..=0x2e7u16 {
            keys.insert(EKey::new(code));
        }
        Ok(VirtualDeviceBuilder::new()
            .context("open /dev/uinput — is the uinput module loaded and are you in the uinput group?")?
            .name(VIRT_NAME)
            .with_keys(&keys)
            .context("with_keys")?
            .build()
            .context("build virtual device")?)
    }

    // ------------------------------------------------------------------
    // Inject a list of (key_name, is_press) events via uinput
    // ------------------------------------------------------------------

    fn inject(virt: &mut evdev::uinput::VirtualDevice, events: &[(String, bool)]) {
        for (name, pressed) in events {
            if let Some(key) = name_to_key(name) {
                let value: i32 = if *pressed { 1 } else { 0 };
                let _ = virt.emit(&[
                    InputEvent::new(EventType::KEY, key.code(), value),
                    InputEvent::new(EventType::SYNCHRONIZATION, 0, 0),
                ]);
            }
        }
    }

    // ------------------------------------------------------------------
    // Linux async event loop
    // ------------------------------------------------------------------

    /// Grab a device and spawn its reader task. The grabbed-paths set keeps
    /// hotplug rescans from double-grabbing; a path is released when the
    /// reader exits (device unplugged / read error).
    fn grab_and_spawn(
        path: PathBuf,
        mut dev: Device,
        tx: mpsc::Sender<DaemonEvent>,
        grabbed: Arc<Mutex<HashSet<PathBuf>>>,
    ) {
        let dev_id = dev_id(&dev);
        if let Err(e) = dev.grab() {
            eprintln!("Could not grab {} ({}): {e}", dev_id.name, path.display());
            grabbed.lock().unwrap().remove(&path);
            return;
        }
        println!("Grabbed keyboard: {} [{}]", dev_id.name, dev_id.id);
        tokio::spawn(async move {
            let mut stream = match dev.into_event_stream() {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("event_stream error: {e}");
                    grabbed.lock().unwrap().remove(&path);
                    return;
                }
            };
            loop {
                match stream.next_event().await {
                    Err(e) => {
                        println!("Keyboard disconnected: {} ({e})", dev_id.name);
                        break;
                    }
                    Ok(ev) if ev.event_type() == EventType::KEY => {
                        let value = ev.value();
                        if value == 0 || value == 1 { // 0=release 1=press (skip 2=autorepeat)
                            let event = DaemonEvent::Key {
                                dev: dev_id.clone(),
                                key: code_to_name(ev.code()),
                                press: value == 1,
                            };
                            let _ = tx.send(event).await;
                        }
                    }
                    Ok(_) => {}
                }
            }
            grabbed.lock().unwrap().remove(&path);
        });
    }

    fn scan_keyboards(tx: &mpsc::Sender<DaemonEvent>, grabbed: &Arc<Mutex<HashSet<PathBuf>>>) -> usize {
        let mut new = 0;
        for (path, dev) in find_keyboards() {
            if !grabbed.lock().unwrap().insert(path.clone()) {
                continue; // already grabbed
            }
            grab_and_spawn(path, dev, tx.clone(), grabbed.clone());
            new += 1;
        }
        new
    }

    pub async fn run(state: Arc<Mutex<Engine>>) -> anyhow::Result<()> {
        let config_path = config_path();
        let (tx, mut rx) = mpsc::channel::<DaemonEvent>(1000);

        // --- Create virtual output device BEFORE grabbing, so the grab
        //     filter (which skips VIRT_NAME) always sees it. ---
        let mut virt = create_virtual_device()?;
        println!("Virtual keyboard created.");

        // --- Grab keyboards ---
        let grabbed: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));
        if scan_keyboards(&tx, &grabbed) == 0 {
            anyhow::bail!(
                "No keyboard devices found in /dev/input/.\n\
                 Make sure you are in the 'input' group (run setup_linux.sh)."
            );
        }

        // --- Watch /dev/input for hotplug (QMK boards re-enumerate on
        //     replug and firmware flashes) ---
        let (dev_tx, mut dev_rx) = mpsc::channel::<()>(4);
        let mut dev_watcher = notify::RecommendedWatcher::new(
            move |res: Result<notify::Event, _>| {
                if res.is_ok() { let _ = dev_tx.blocking_send(()); }
            },
            NotifyConfig::default(),
        )?;
        dev_watcher.watch(std::path::Path::new("/dev/input"), RecursiveMode::NonRecursive)?;
        println!("Watching /dev/input for keyboard hotplug.");

        // --- Watch config file ---
        let (cfg_tx, mut cfg_rx) = mpsc::channel::<()>(4);
        let mut watcher = notify::RecommendedWatcher::new(
            move |res: Result<notify::Event, _>| {
                if res.is_ok() { let _ = cfg_tx.blocking_send(()); }
            },
            NotifyConfig::default(),
        )?;
        watcher.watch(&config_path, RecursiveMode::NonRecursive)?;
        println!("Watching config: {}", config_path.display());

        let mut last_layer = String::from("base");

        loop {
            tokio::select! {
                Some(event) = rx.recv() => {
                    let (to_inject, layer_name) = state.lock().unwrap().handle(event, &tx);
                    if layer_name != last_layer {
                        write_state(&layer_name);
                        last_layer = layer_name;
                    }
                    inject(&mut virt, &to_inject);
                }
                Some(_) = dev_rx.recv() => {
                    // Give udev a moment to apply permissions on the new node.
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    while dev_rx.try_recv().is_ok() {} // coalesce bursts
                    scan_keyboards(&tx, &grabbed);
                }
                Some(_) = cfg_rx.recv() => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    match load_config(&config_path) {
                        Ok(cfg) => state.lock().unwrap().update_config(cfg),
                        Err(e)  => eprintln!("Config reload error: {e}"),
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Windows: rdev low-level keyboard hooks  (WinAPI SetWindowsHookEx)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;

    static SIMULATING: AtomicUsize = AtomicUsize::new(0);

    fn key_to_name(key: &rdev::Key) -> Option<String> {
        serde_json::to_value(key).ok()
            .and_then(|v| if let serde_json::Value::String(s) = v { Some(s) } else { None })
    }

    fn name_to_key(name: &str) -> Option<rdev::Key> {
        serde_json::from_str(&format!("\"{name}\"")).ok()
    }

    fn sim(key_name: &str, pressed: bool) {
        if let Some(rk) = name_to_key(key_name) {
            let et = if pressed {
                rdev::EventType::KeyPress(rk)
            } else {
                rdev::EventType::KeyRelease(rk)
            };
            SIMULATING.fetch_add(1, Ordering::SeqCst);
            let _ = rdev::simulate(&et);
            SIMULATING.fetch_sub(1, Ordering::SeqCst);
        }
    }

    pub async fn run(state: Arc<Mutex<Engine>>) -> anyhow::Result<()> {
        let config_path = config_path();
        let (tx, mut rx) = mpsc::channel::<DaemonEvent>(1000);
        let tx_grab = tx.clone();

        // Windows low-level hooks give no per-device identity, so all input
        // routes to the global active profile (device-pinned profiles are a
        // Linux-only feature).
        let dev_grab: Arc<DevId> = Arc::new(DevId { name: String::new(), id: String::new() });

        thread::spawn(move || {
            let _ = rdev::grab(move |event: rdev::Event| {
                if SIMULATING.load(Ordering::SeqCst) > 0 {
                    return Some(event);
                }
                match event.event_type {
                    rdev::EventType::KeyPress(key) => {
                        if let Some(name) = key_to_name(&key) {
                            let _ = tx_grab.blocking_send(DaemonEvent::Key { dev: dev_grab.clone(), key: name, press: true });
                        }
                        None
                    }
                    rdev::EventType::KeyRelease(key) => {
                        if let Some(name) = key_to_name(&key) {
                            let _ = tx_grab.blocking_send(DaemonEvent::Key { dev: dev_grab.clone(), key: name, press: false });
                        }
                        None
                    }
                    _ => Some(event),
                }
            });
        });

        let (cfg_tx, mut cfg_rx) = mpsc::channel::<()>(4);
        let mut watcher = notify::RecommendedWatcher::new(
            move |res: Result<notify::Event, _>| {
                if res.is_ok() { let _ = cfg_tx.blocking_send(()); }
            },
            NotifyConfig::default(),
        )?;
        watcher.watch(&config_path, RecursiveMode::NonRecursive)?;
        println!("Watching config: {}", config_path.display());

        let mut last_layer = String::from("base");

        loop {
            tokio::select! {
                Some(event) = rx.recv() => {
                    let (to_inject, layer_name) = state.lock().unwrap().handle(event, &tx);
                    if layer_name != last_layer {
                        write_state(&layer_name);
                        last_layer = layer_name;
                    }
                    for (key, pressed) in to_inject {
                        sim(&key, pressed);
                    }
                }
                Some(_) = cfg_rx.recv() => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    match load_config(&config_path) {
                        Ok(cfg) => state.lock().unwrap().update_config(cfg),
                        Err(e)  => eprintln!("Config reload error: {e}"),
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> Config {
        let base_layer = shared::Layer { name: "base".into(), trigger: None, mappings: vec![] };
        Config {
            settings: shared::AppSettings::default(),
            active_profile: "default".into(),
            profiles: vec![
                shared::Profile { name: "default".into(), device: None, layers: vec![base_layer.clone()], socd_pairs: vec![] },
                shared::Profile { name: "qmk".into(), device: Some("feed:6060".into()), layers: vec![base_layer.clone()], socd_pairs: vec![] },
                shared::Profile { name: "corne".into(), device: Some("Corne".into()), layers: vec![base_layer], socd_pairs: vec![] },
            ],
        }
    }

    #[test]
    fn routes_by_vendor_product_id() {
        let e = Engine::new(test_config());
        let dev = DevId { name: "some qmk board".into(), id: "feed:6060".into() };
        assert_eq!(e.profile_for_device(&dev), "qmk");
    }

    #[test]
    fn routes_by_name_substring_case_insensitive() {
        let e = Engine::new(test_config());
        let dev = DevId { name: "foostan corne v4".into(), id: "4653:0001".into() };
        assert_eq!(e.profile_for_device(&dev), "corne");
    }

    #[test]
    fn unmatched_device_uses_active_profile() {
        let e = Engine::new(test_config());
        let dev = DevId { name: "Generic USB Keyboard".into(), id: "046d:c31c".into() };
        assert_eq!(e.profile_for_device(&dev), "default");
    }

    #[test]
    fn unmapped_key_passes_through() {
        let mut e = Engine::new(test_config());
        let (tx, _rx) = mpsc::channel::<DaemonEvent>(16);
        let dev = Arc::new(DevId { name: "kb".into(), id: "feed:6060".into() });
        let (out, _) = e.handle(DaemonEvent::Key { dev: dev.clone(), key: "Raw164".into(), press: true }, &tx);
        assert_eq!(out, vec![("Raw164".to_string(), true)]);
        let (out, _) = e.handle(DaemonEvent::Key { dev, key: "Raw164".into(), press: false }, &tx);
        assert_eq!(out, vec![("Raw164".to_string(), false)]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn raw_key_names_round_trip() {
        // Named key
        assert_eq!(linux::code_to_name(164), "PlayPause");
        assert_eq!(linux::name_to_key("PlayPause").map(|k| k.code()), Some(164));
        // Unnamed key falls back to Raw<code> and maps back to the same code
        let name = linux::code_to_name(250);
        assert_eq!(name, "Raw250");
        assert_eq!(linux::name_to_key(&name).map(|k| k.code()), Some(250));
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config_path = config_path();
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    if !config_path.exists() {
        let default = Config {
            settings: shared::AppSettings::default(),
            profiles: vec![shared::Profile {
                name: "default".to_string(),
                device: None,
                layers: vec![shared::Layer {
                    name: "base".to_string(),
                    trigger: None,
                    mappings: vec![shared::Mapping {
                        from: "CapsLock".to_string(),
                        to: Target::ModTap {
                            hold: "ControlLeft".to_string(),
                            tap: "Escape".to_string(),
                            hold_ms: 200,
                        },
                    }],
                }],
                socd_pairs: vec![],
            }],
            active_profile: "default".to_string(),
        };
        std::fs::write(&config_path, serde_yaml::to_string(&default)?)?;
        println!("Created default config at {}", config_path.display());
    }

    let config = load_config(&config_path)?;
    let state = Arc::new(Mutex::new(Engine::new(config)));
    println!("KeyMapper daemon starting — config: {}", config_path.display());

    #[cfg(target_os = "linux")]
    linux::run(state).await?;

    #[cfg(target_os = "windows")]
    windows::run(state).await?;

    Ok(())
}
