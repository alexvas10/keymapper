# KeyMapper

KeyMapper is a high-performance, cross-platform (Windows, Linux, macOS) system for keyboard/mouse remapping and macros. It is designed for gamers and power users who demand the lowest possible input latency.

Inspired by tools like AutoHotkey and Wootility, KeyMapper provides a visual interface for configuration while maintaining a lean, independent background daemon for performance.

**You install one thing: the daemon.** The editor is a website — open it, point it at your KeyMapper folder, and every change you save applies immediately. Close the browser and your remappings keep working, because the daemon never needed it in the first place.

## 🚀 Key Features

- **Extreme Low Latency:** The remapping engine is written in Rust and uses low-level OS hooks to intercept input at the source.
- **Nothing to install but the daemon:** No desktop app, no packages, no updater. The editor runs in your browser and writes your config file directly.
- **Decoupled Architecture:** The daemon (`keymapper-daemon`) runs independently of the editor. Your remappings stay active whether or not a browser is open.
- **Hot-Reloading:** Any change to `config.yaml` is picked up by the daemon instantly — saving *is* applying.
- **Portable Profiles:** Configurations are stored in simple YAML files that can be exported and shared across devices.
- **Built-in Typing Trainer:** A keybr-style Practice view that teaches you the layout you just built, with a live keyboard guide showing where each letter now lives.
- **Per-Keyboard Profiles (Linux):** Pin a profile to a specific keyboard — e.g. give your QMK board its own bindings while your laptop keyboard keeps the default profile.
- **QMK / Custom Keyboard Friendly:** Extended media/system keycodes are supported, unknown keycodes pass through untouched (as remappable `Raw<code>` keys), and keyboards are picked up on hotplug — replugging or reflashing a board doesn't require a daemon restart.
- **Cross-Platform:** Works on Windows, Linux, and macOS.

## 🛠️ Project Structure

- `/daemon`: The core remapping engine (Rust). The only thing that gets installed.
- `/gui`: The editor — a static React site with no backend.
- `/shared`: Shared types and configuration schema.

## 📂 Where your config lives

```
~/KeyMapper/
  config.yaml        your mappings — you edit, the daemon watches
  state.json         the daemon's heartbeat and active layer — it writes
  devices.json       connected keyboards — it writes
  typing_stats.json  Practice progress
```

On Windows this is `%USERPROFILE%\KeyMapper\`. Set `KEYMAPPER_DIR` to put it somewhere else.

If you used an earlier release, your config was in `~/.config/keymapper` (`%APPDATA%\keymapper` on Windows). **The daemon moves it for you on first run** and leaves a note behind saying where it went.

<details>
<summary>Why not <code>~/.config</code>, like everything else?</summary>

Because a browser cannot reach it. Chromium blocklists the platform configuration directory from its file pickers — `~/.config` on Linux, `%APPDATA%` on Windows, `~/Library` on macOS — and refuses to open a file there even when you pick it by hand. It is deliberate hardening, there is no flag for it, and it applies to files as well as folders. Anything directly under your home folder is reachable, so that is where the config lives.

</details>

## 📦 Installation

### Linux

1. Configure `udev` rules and group membership:
   ```bash
   chmod +x setup_linux.sh
   ./setup_linux.sh
   ```
2. **Log out and log back in** for the group changes to take effect.
3. Build and install the daemon, and register the systemd user service:
   ```bash
   ./install.sh
   systemctl --user enable --now keymapper
   ```

### Windows

**Prerequisite — the Windows SDK.** Rust's MSVC target links against the SDK's import
libraries (`kernel32.lib`, `user32.lib`) and needs `rc.exe` to embed the app manifest. Without
it the build fails with `LNK1181: cannot open input file 'kernel32.lib'`. Install it from the
**Visual Studio Installer** → *Modify* → *Individual components* → latest **Windows 11 SDK**
(or the whole *Desktop development with C++* workload). Don't use `winget` for this — the only
Windows SDKs it publishes are from 2018.

This is a build-time requirement only. Machines that merely *run* KeyMapper need nothing extra.

1. Build the daemon (this locates MSVC via `vswhere` and sets up the developer environment,
   which is not on `PATH` by default):
   ```powershell
   .\build_windows.ps1 -DaemonOnly
   ```
2. Install it and register autostart at logon — no administrator rights required:
   ```powershell
   .\setup_windows.ps1
   ```
   To remove it again: `.\setup_windows.ps1 -Uninstall`

This installs a **Scheduled Task**, not a Windows service. The daemon intercepts input with a
`WH_KEYBOARD_LL` hook, and low-level keyboard hooks are only delivered to a process on the
interactive desktop. Services run in session 0, which has no desktop, so a service would start
and then never receive a keystroke.

*Note: remapping does not apply inside elevated windows (Task Manager, UAC prompts). That
requires `uiAccess="true"`, which Windows only permits for an Authenticode-signed binary in a
secure location — it refuses to launch an unsigned one at all. Once you have a certificate,
build with `.\build_windows.ps1 -UiAccess` and install to `C:\Program Files`.*

### macOS
1. Build the daemon and add it to **System Settings > Privacy & Security > Accessibility**.
2. Run the daemon using the provided `LaunchAgent` template for persistence.

## ⌨️ Usage

### Running the daemon

```bash
systemctl --user enable --now keymapper   # now, and at every login
systemctl --user stop keymapper           # stop it
```

Or run it directly: `keymapper-daemon`.

### Using the editor

On a Chromium browser, click **Choose folder** and pick `KeyMapper` in your home folder. You are
asked once; the browser remembers it. From then on, saving writes `config.yaml` and the daemon
applies it — no restart, no reload button.

On Firefox, Zen or Safari, drop your `config.yaml` onto the page instead. Edit it, hit
**Download**, and move the file back into `KeyMapper`. Your work in progress is kept in the
browser between visits, so a refresh does not lose it.

Nothing is uploaded anywhere. The page reads and writes that one folder, and the site has no
backend to send anything to.

To run the editor locally:
```bash
cd gui
npm install
npm run dev
```

### Browser support

Every browser can edit your mappings. What differs is how the file gets to disk.

| Browser | How saving works |
|---------|------------------|
| Chrome, Edge, Brave, Arc | **Writes your config file directly.** Grant the folder once; saving applies instantly. |
| Firefox, Zen, Safari | **Upload and download.** Drop `config.yaml` in, edit, download it back to your `KeyMapper` folder. |

The split is the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API):
Chromium lets a page write to a folder you choose, and Gecko and WebKit ship only the sandboxed
Origin Private File System, which cannot reach a real file. Either way the daemon behaves
identically — it is watching the file, so it applies your changes the moment they land.

## 🎓 Practice

Remapping your keyboard is the easy part — relearning it is the work. The **Practice** tab is a
typing trainer modelled on [keybr](https://www.keybr.com), built around the layout you have
configured rather than a fixed one.

- **Letters arrive by frequency, not by position.** Lessons start with the six most common letters
  in English (`e t a o i n`) and add another only once every letter in play is at your target
  speed. Because the order comes from the language, it works identically for QWERTY, Colemak,
  Dvorak or anything you invented yourself — only *where* the letters sit changes.
- **Whole real words, every one containing the letter you are drilling.** This is how keybr does it,
  and it is what builds muscle memory for words rather than for isolated keys — a lesson on `e` with
  six letters unlocked reads `tie eat eaten intent tone none neat tent attention nine note ten`.
  Words are drawn from the commonest four thousand English words that your layout can spell. If an
  alphabet is too sparse to spell enough of them, pseudo-words from a character-level trigram model
  of English fill in — and they contain the drilled letter too.
- **A key is learnt when you hit the target speed on it** — `confidence = targetTime / yourTime`,
  so 1.0 means you are typing that key at target. The weakest key is focused and drilled harder.
- **The keyboard guide** is a 60% board — the function row, arrows and numpad play no part in
  typing — showing each key's remapped output, the legend printed on your physical keycap, the
  finger to use, and the next key to press. Letters not yet unlocked are dimmed.
- **Works with the daemon running or stopped.** *Automatic* reads keystrokes as remapped by the
  daemon when it is running, and applies your mappings in the app when it is not, so you can
  practise a layout before committing to it. *In-app* forces the latter. *Raw* applies nothing at
  all and drills the board as its keycaps read — for when the remapping already lives in your
  keyboard's own firmware (VIA, QMK, Wootility). Raw progress is tracked separately from your
  profiles.

Per-key statistics live in your browser and are mirrored to `typing_stats.json` alongside your
config, so they survive clearing site data and travel with your profile.

## 📝 Configuration (YAML)

Advanced users can edit `~/KeyMapper/config.yaml` directly:

```yaml
profiles:
- name: default
  device: null
  layers:
  - name: base
    trigger: null
    mappings:
    - from: CapsLock
      to:
        type: key
        key: Escape
    - from: F1
      to:
        type: macro
        steps:
        - action:
            type: press
            key: ControlLeft
        - action:
            type: tap
            key: KeyC
        - action:
            type: release
            key: ControlLeft
          delay_ms: 50
  socd_pairs: []
active_profile: default
```

Mapping targets are `key`, `macro`, `mod_tap`, `toggle`, `command` and `layer`.

> ⚠️ A `command` target is executed with `sh -c`. A config file is therefore executable code —
> treat one you did not write with the same caution as a shell script. The editor flags any
> `command` mappings before it will save an imported config.

### Per-keyboard profiles (QMK boards, etc.)

On Linux, a profile can be bound to one physical keyboard with the `device` field —
either the `vendor:product` id (hex, as shown by the editor's Keyboard selector or
`lsusb`; many QMK boards use `feed:xxxx`) or a case-insensitive substring of the
device name:

```yaml
profiles:
- name: default          # used by every keyboard not matched below
  ...
- name: my-qmk-board
  device: "feed:6060"    # or e.g. device: "corne"
  ...
```

Events from a matched keyboard always use that profile, regardless of the global
active profile. In the editor, select the device from the **Keyboard** dropdown next
to the layer tabs. Keys the daemon has no name for are passed through and can be
remapped as `Raw<keycode>`.

## 🛠️ Development

- **Prerequisites:** Rust, Node.js, and platform-specific build tools (Linux: build-essential,
  x11-dev, etc. — Windows: MSVC and the Windows SDK, see [Installation](#windows)).
- **Build:** `cargo build --release` (on Windows use `.\build_windows.ps1`, which sets up
  the MSVC developer environment first)
- **Run tests:** `cargo test`, and `cd gui && npm run test:config` for the config
  reader/writer — it checks that a config round-trips through the browser byte-for-byte, which is
  what stops a serializer bug from quietly destroying someone's mappings.

## ⚖️ License
MIT
