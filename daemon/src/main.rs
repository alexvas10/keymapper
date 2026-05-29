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

enum DaemonEvent {
    KeyPress(String),
    KeyRelease(String),
    HoldTimerFired(String),
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
// AppState — entirely platform-agnostic.
// on_press / on_release / on_hold_timer return Vec<(String, bool)>:
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
    fn new(config: Config) -> Self {
        let active = config.active_profile.clone();
        let mut s = Self {
            active_profile_name: active,
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

    fn update_config(&mut self, config: Config) {
        self.active_profile_name = config.active_profile.clone();
        self.config = config;
        self.rebuild();
        println!("Config reloaded. Active profile: {}", self.active_profile_name);
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
                let tx2 = tx.clone();
                tokio::spawn(async move {
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(hold_ms)) => {
                            let _ = tx2.send(DaemonEvent::HoldTimerFired(key_owned)).await;
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
            _ => return None,
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
            _ => return None,
        })
    }

    // ------------------------------------------------------------------
    // Find all keyboard devices in /dev/input/
    // A device is considered a keyboard if it reports KEY_SPACE.
    // ------------------------------------------------------------------

    fn find_keyboards() -> Vec<Device> {
        evdev::enumerate()
            .map(|(_, d)| d)
            .filter(|d| d.supported_keys()
                .map_or(false, |keys| keys.contains(EKey::KEY_SPACE)))
            .collect()
    }

    // ------------------------------------------------------------------
    // Create uinput virtual keyboard with all keys we might output
    // ------------------------------------------------------------------

    fn create_virtual_device() -> anyhow::Result<evdev::uinput::VirtualDevice> {
        const ALL_NAMES: &[&str] = &[
            "KeyA","KeyB","KeyC","KeyD","KeyE","KeyF","KeyG","KeyH","KeyI","KeyJ",
            "KeyK","KeyL","KeyM","KeyN","KeyO","KeyP","KeyQ","KeyR","KeyS","KeyT",
            "KeyU","KeyV","KeyW","KeyX","KeyY","KeyZ",
            "Num0","Num1","Num2","Num3","Num4","Num5","Num6","Num7","Num8","Num9",
            "F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12",
            "F13","F14","F15","F16","F17","F18","F19","F20","F21","F22","F23","F24",
            "ShiftLeft","ShiftRight","ControlLeft","ControlRight",
            "Alt","AltGr","MetaLeft","MetaRight","CapsLock",
            "Return","Backspace","Tab","Space","Escape",
            "UpArrow","DownArrow","LeftArrow","RightArrow",
            "Home","End","PageUp","PageDown","Insert","Delete",
            "PrintScreen","ScrollLock","Pause","NumLock",
            "BackQuote","Minus","Equal","LeftBracket","RightBracket",
            "BackSlash","SemiColon","Quote","Comma","Dot","Slash","IntlBackslash",
            "Kp0","Kp1","Kp2","Kp3","Kp4","Kp5","Kp6","Kp7","Kp8","Kp9",
            "KpPlus","KpMinus","KpMultiply","KpDivide","KpReturn","KpDelete",
            "VolumeUp","VolumeDown","VolumeMute",
        ];
        let keys: AttributeSet<EKey> = ALL_NAMES.iter()
            .filter_map(|n| name_to_key(n))
            .collect();
        Ok(VirtualDeviceBuilder::new()
            .context("open /dev/uinput — is the uinput module loaded and are you in the uinput group?")?
            .name("KeyMapper")
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

    pub async fn run(state: Arc<Mutex<AppState>>) -> anyhow::Result<()> {
        let config_path = config_path();
        let (tx, mut rx) = mpsc::channel::<DaemonEvent>(1000);

        // --- Grab keyboards ---
        let keyboards = find_keyboards();
        if keyboards.is_empty() {
            anyhow::bail!(
                "No keyboard devices found in /dev/input/.\n\
                 Make sure you are in the 'input' group (run setup_linux.sh)."
            );
        }

        for mut dev in keyboards {
            let name = dev.name().unwrap_or("unknown").to_owned();
            dev.grab().with_context(|| format!("grab {name}"))?;
            println!("Grabbed keyboard: {name}");
            let tx2 = tx.clone();
            tokio::spawn(async move {
                let mut stream = match dev.into_event_stream() {
                    Ok(s) => s,
                    Err(e) => { eprintln!("event_stream error: {e}"); return; }
                };
                loop {
                    match stream.next_event().await {
                        Err(e) => { eprintln!("read error: {e}"); break; }
                        Ok(ev) if ev.event_type() == EventType::KEY => {
                            let value = ev.value();
                            if value == 0 || value == 1 { // 0=release 1=press (skip 2=autorepeat)
                                let key = EKey::new(ev.code());
                                if let Some(name) = key_to_name(key) {
                                    let event = if value == 1 {
                                        DaemonEvent::KeyPress(name.to_owned())
                                    } else {
                                        DaemonEvent::KeyRelease(name.to_owned())
                                    };
                                    let _ = tx2.send(event).await;
                                }
                            }
                        }
                        Ok(_) => {}
                    }
                }
            });
        }

        // --- Create virtual output device ---
        let mut virt = create_virtual_device()?;
        println!("Virtual keyboard created.");

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
                    let (to_inject, layer_name) = match event {
                        DaemonEvent::InjectDirect(key, pressed) => {
                            let layer = state.lock().unwrap().active_display_layer.clone();
                            (vec![(key, pressed)], layer)
                        }
                        _ => {
                            let mut s = state.lock().unwrap();
                            let out = match event {
                                DaemonEvent::KeyPress(k)      => s.on_press(&k, &tx),
                                DaemonEvent::KeyRelease(k)    => s.on_release(&k),
                                DaemonEvent::HoldTimerFired(k)=> s.on_hold_timer(&k),
                                DaemonEvent::InjectDirect(..) => unreachable!(),
                            };
                            (out, s.active_display_layer.clone())
                        }
                    };
                    if layer_name != last_layer {
                        write_state(&layer_name);
                        last_layer = layer_name;
                    }
                    inject(&mut virt, &to_inject);
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

    pub async fn run(state: Arc<Mutex<AppState>>) -> anyhow::Result<()> {
        let config_path = config_path();
        let (tx, mut rx) = mpsc::channel::<DaemonEvent>(1000);
        let tx_grab = tx.clone();

        thread::spawn(move || {
            let _ = rdev::grab(move |event: rdev::Event| {
                if SIMULATING.load(Ordering::SeqCst) > 0 {
                    return Some(event);
                }
                match event.event_type {
                    rdev::EventType::KeyPress(key) => {
                        if let Some(name) = key_to_name(&key) {
                            let _ = tx_grab.blocking_send(DaemonEvent::KeyPress(name));
                        }
                        None
                    }
                    rdev::EventType::KeyRelease(key) => {
                        if let Some(name) = key_to_name(&key) {
                            let _ = tx_grab.blocking_send(DaemonEvent::KeyRelease(name));
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
                    let (to_inject, layer_name) = match event {
                        DaemonEvent::InjectDirect(key, pressed) => {
                            let layer = state.lock().unwrap().active_display_layer.clone();
                            (vec![(key, pressed)], layer)
                        }
                        _ => {
                            let mut s = state.lock().unwrap();
                            let out = match event {
                                DaemonEvent::KeyPress(k)       => s.on_press(&k, &tx),
                                DaemonEvent::KeyRelease(k)     => s.on_release(&k),
                                DaemonEvent::HoldTimerFired(k) => s.on_hold_timer(&k),
                                DaemonEvent::InjectDirect(..)  => unreachable!(),
                            };
                            (out, s.active_display_layer.clone())
                        }
                    };
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
    let state = Arc::new(Mutex::new(AppState::new(config)));
    println!("KeyMapper daemon starting — config: {}", config_path.display());

    #[cfg(target_os = "linux")]
    linux::run(state).await?;

    #[cfg(target_os = "windows")]
    windows::run(state).await?;

    Ok(())
}
