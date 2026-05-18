# KeyMapper

KeyMapper is a high-performance, cross-platform (Windows, Linux, macOS) system for keyboard/mouse remapping and macros. It is designed for gamers and power users who demand the lowest possible input latency.

Inspired by tools like AutoHotkey and Wootility, KeyMapper provides a visual interface for configuration while maintaining a lean, independent background daemon for performance.

## 🚀 Key Features

- **Extreme Low Latency:** The remapping engine is written in Rust and uses low-level OS hooks to intercept input at the source.
- **Decoupled Architecture:** The background daemon (`keymapper-d`) runs independently of the GUI. Your remappings stay active even if the GUI is closed.
- **Visual Editor:** A modern, visual GUI (Tauri + React) for mapping keys and building complex macros without touching a text editor.
- **Hot-Reloading:** Any changes to the `config.yaml` are instantly picked up by the daemon.
- **Portable Profiles:** Configurations are stored in simple YAML files that can be exported and shared across devices.
- **Cross-Platform:** Works on Windows, Linux, and macOS.

## 🛠️ Project Structure

- `/daemon`: The core remapping engine (Rust).
- `/gui`: The visual configuration editor (Tauri + React).
- `/shared`: Shared types and configuration schema.

## 📦 Installation

### Linux
1. Run the setup script to configure `udev` rules and permissions:
   ```bash
   chmod +x setup_linux.sh
   ./setup_linux.sh
   ```
2. **Log out and log back in** for the group changes to take effect.
3. Build the daemon:
   ```bash
   cargo build --release -p daemon
   ```

### Windows
1. Run PowerShell as **Administrator**.
2. Run the installation script:
   ```powershell
   .\setup_windows.ps1
   ```
*Note: For the lowest latency and remapping in Administrator windows (like Task Manager), the binary must be installed in `C:\Program Files` and digitally signed.*

### macOS
1. Build the daemon and add it to **System Settings > Privacy & Security > Accessibility**.
2. Run the daemon using the provided `LaunchAgent` template for persistence.

## ⌨️ Usage

### Running the Daemon
The daemon looks for `config.yaml` in its working directory.
```bash
./keymapper-d
```

### Using the GUI
The GUI allows you to visually edit the `config.yaml` used by the daemon.
```bash
cd gui
npm install
npm run tauri dev
```

## 📝 Configuration (YAML)

Advanced users can edit the `config.yaml` directly:

```yaml
active_profile: default
profiles:
  - name: default
    mappings:
      - from: CapsLock
        to: Escape
      - from: F1
        to:
          - action: press
            key: ControlLeft
          - action: tap
            key: KeyC
          - action: release
            key: ControlLeft
            delay_ms: 50
```

## 🛠️ Development

- **Prerequisites:** Rust, Node.js, and platform-specific build tools (build-essential, x11-dev, etc.).
- **Build All:** `cargo build --release`
- **Run Tests:** `cargo test`

## ⚖️ License
MIT
