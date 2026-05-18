use rdev::{grab, Event, EventType, Key};
use shared::{Config, Mapping, Target, MacroAction};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::path::Path;
use notify::{Watcher, RecursiveMode, Config as NotifyConfig};
use anyhow::Context;

struct DaemonState {
    #[allow(dead_code)]
    config: Config,
    mappings: HashMap<Key, Target>,
}

impl DaemonState {
    fn new(config: Config) -> Self {
        let mut mappings = HashMap::new();
        if let Some(profile) = config.profiles.iter().find(|p| p.name == config.active_profile) {
            for mapping in &profile.mappings {
                mappings.insert(mapping.from, mapping.to.clone());
            }
        }
        Self { config, mappings }
    }

    fn update_config(&mut self, config: Config) {
        let mut mappings = HashMap::new();
        if let Some(profile) = config.profiles.iter().find(|p| p.name == config.active_profile) {
            for mapping in &profile.mappings {
                mappings.insert(mapping.from, mapping.to.clone());
            }
        }
        self.config = config;
        self.mappings = mappings;
        println!("Config updated. Active profile: {}", self.config.active_profile);
    }
}

fn callback(event: Event, state: &Arc<Mutex<DaemonState>>) -> Option<Event> {
    let state = state.lock().unwrap();
    match event.event_type {
        EventType::KeyPress(key) | EventType::KeyRelease(key) => {
            if let Some(target) = state.mappings.get(&key) {
                match target {
                    Target::Key(target_key) => {
                        let new_event_type = match event.event_type {
                            EventType::KeyPress(_) => EventType::KeyPress(*target_key),
                            EventType::KeyRelease(_) => EventType::KeyRelease(*target_key),
                            _ => unreachable!(),
                        };
                        Some(Event {
                            event_type: new_event_type,
                            time: event.time,
                            name: None,
                        })
                    }
                    Target::Macro(steps) => {
                        if let EventType::KeyPress(_) = event.event_type {
                            let steps = steps.clone();
                            thread::spawn(move || {
                                for step in steps {
                                    match step.action {
                                        MacroAction::Press(k) => {
                                            let _ = rdev::simulate(&EventType::KeyPress(k));
                                        }
                                        MacroAction::Release(k) => {
                                            let _ = rdev::simulate(&EventType::KeyRelease(k));
                                        }
                                        MacroAction::Tap(k) => {
                                            let _ = rdev::simulate(&EventType::KeyPress(k));
                                            let _ = rdev::simulate(&EventType::KeyRelease(k));
                                        }
                                    }
                                    if let Some(delay) = step.delay_ms {
                                        thread::sleep(std::time::Duration::from_millis(delay));
                                    }
                                }
                            });
                        }
                        None // Swallow the original key
                    }
                }
            } else {
                Some(event)
            }
        }
        _ => Some(event),
    }
}

fn load_config(path: &Path) -> anyhow::Result<Config> {
    let content = std::fs::read_to_string(path).context("Failed to read config file")?;
    let config: Config = serde_yaml::from_str(&content).context("Failed to parse config file")?;
    Ok(config)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config_path = Path::new("config.yaml");
    
    // Create a default config if it doesn't exist
    if !config_path.exists() {
        let default_config = Config {
            profiles: vec![shared::Profile {
                name: "default".to_string(),
                mappings: vec![Mapping {
                    from: Key::CapsLock,
                    to: Target::Key(Key::Escape),
                }],
            }],
            active_profile: "default".to_string(),
        };
        let yaml = serde_yaml::to_string(&default_config)?;
        std::fs::write(config_path, yaml)?;
        println!("Created default config.yaml");
    }

    let initial_config = load_config(config_path)?;
    let state = Arc::new(Mutex::new(DaemonState::new(initial_config)));
    let state_for_callback = Arc::clone(&state);
    let state_for_watcher = Arc::clone(&state);

    println!("Starting KeyMapper Daemon...");
    
    // Start the grab loop in a separate thread
    thread::spawn(move || {
        if let Err(error) = grab(move |event| callback(event, &state_for_callback)) {
            eprintln!("Error in grab loop: {:?}", error);
            eprintln!("Note: On Linux, you might need to be in the 'input' group or run with sudo for initial testing.");
        }
    });

    // Set up file watcher
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    let mut watcher = notify::RecommendedWatcher::new(move |res| {
        if let Ok(_) = res {
            let _ = tx.blocking_send(());
        }
    }, NotifyConfig::default())?;

    watcher.watch(config_path, RecursiveMode::NonRecursive)?;

    println!("Watching for config changes in config.yaml...");

    while let Some(_) = rx.recv().await {
        // Debounce or just reload
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        match load_config(config_path) {
            Ok(new_config) => {
                let mut state = state_for_watcher.lock().unwrap();
                state.update_config(new_config);
            }
            Err(e) => eprintln!("Error reloading config: {:?}", e),
        }
    }

    Ok(())
}
