#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== KeyMapper Install ==="

# Check dependencies
if ! command -v cargo &>/dev/null; then
    echo "Error: cargo not found. Install Rust from https://rustup.rs"
    exit 1
fi
if ! command -v npm &>/dev/null; then
    echo "Error: npm not found. Install Node.js from https://nodejs.org"
    exit 1
fi
if ! cargo tauri --version &>/dev/null 2>&1; then
    echo "Installing tauri-cli..."
    cargo install tauri-cli --version "^2"
fi

# Install frontend dependencies if needed
if [ ! -d gui/node_modules ]; then
    echo "Installing frontend dependencies..."
    (cd gui && npm install)
fi

echo "Building daemon..."
cargo build --release -p daemon

echo "Building GUI frontend..."
(cd gui && npm run build)

echo "Building GUI (with bundled frontend)..."
cargo build --release -p keymapper-gui --features keymapper-gui/custom-protocol

# Install binaries
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

cp target/release/keymapper-daemon "$BIN_DIR/keymapper-daemon"
cp target/release/keymapper-gui    "$BIN_DIR/keymapper-gui"
chmod +x "$BIN_DIR/keymapper-daemon" "$BIN_DIR/keymapper-gui"

# Restart the daemon if it's running so the new binary takes effect immediately
if systemctl --user is-active --quiet keymapper 2>/dev/null; then
    echo "Restarting daemon with new binary..."
    systemctl --user restart keymapper
fi

# Create launcher wrapper that activates input/uinput groups from /etc/group
# without requiring a re-login after groupadd.
cat > "$BIN_DIR/keymapper-daemon-launcher" <<LAUNCHER
#!/bin/bash
exec sg input -c "sg uinput -c 'exec $BIN_DIR/keymapper-daemon'"
LAUNCHER
chmod +x "$BIN_DIR/keymapper-daemon-launcher"
echo "Installed binaries to $BIN_DIR"

# Install icon
ICON_DIR="$HOME/.local/share/icons/hicolor/128x128/apps"
mkdir -p "$ICON_DIR"
cp gui/src-tauri/icons/128x128.png "$ICON_DIR/keymapper.png"

# Install .desktop file (makes app appear in launcher)
DESKTOP_DIR="$HOME/.local/share/applications"
mkdir -p "$DESKTOP_DIR"

cat > "$DESKTOP_DIR/keymapper.desktop" <<EOF
[Desktop Entry]
Name=KeyMapper
Comment=Kernel-level key remapper
Exec=$BIN_DIR/keymapper-gui
Icon=keymapper
Type=Application
Categories=Utility;Settings;
StartupNotify=true
EOF

# Refresh launcher database
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo ""
echo "=== Install complete ==="
echo ""
echo "KeyMapper is now in your application launcher."
echo "On first launch, click 'Install Daemon' to set up the background service."
echo ""
echo "To uninstall:"
echo "  rm $BIN_DIR/keymapper-{gui,daemon}"
echo "  rm $DESKTOP_DIR/keymapper.desktop"
echo "  rm $ICON_DIR/keymapper.png"
