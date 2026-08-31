#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== KeyMapper Install ==="

if ! command -v cargo &>/dev/null; then
    echo "Error: cargo not found. Install Rust from https://rustup.rs"
    exit 1
fi

echo "Building daemon..."
cargo build --release -p daemon

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
cp target/release/keymapper-daemon "$BIN_DIR/keymapper-daemon"
chmod +x "$BIN_DIR/keymapper-daemon"
echo "Installed daemon to $BIN_DIR"

# The daemon needs the 'input' and 'uinput' groups. `setup_linux.sh` adds you
# to them, but a login shell started before that will not have them yet, so the
# service is launched through `sg` to pick them up without a re-login.
#
# `sg` is not present on every distribution (Arch, notably, ships only
# `newgrp`). Where it is missing, and where the groups are already active, the
# daemon is run directly — the wrapper exists only to work around a stale
# session, so falling back to a direct exec is correct rather than a compromise.
LAUNCHER="$BIN_DIR/keymapper-daemon-launcher"
if command -v sg &>/dev/null && ! (id -nG | grep -qw input && id -nG | grep -qw uinput); then
    cat > "$LAUNCHER" <<LAUNCHER_EOF
#!/bin/bash
exec sg input -c "sg uinput -c 'exec $BIN_DIR/keymapper-daemon'"
LAUNCHER_EOF
else
    cat > "$LAUNCHER" <<LAUNCHER_EOF
#!/bin/bash
exec "$BIN_DIR/keymapper-daemon"
LAUNCHER_EOF
fi
chmod +x "$LAUNCHER"

# systemd user service
SERVICE_DIR="$HOME/.config/systemd/user"
mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_DIR/keymapper.service" <<EOF
[Unit]
Description=KeyMapper Daemon
After=graphical-session.target

[Service]
ExecStart=$LAUNCHER
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload

if systemctl --user is-active --quiet keymapper 2>/dev/null; then
    echo "Restarting daemon with the new binary..."
    systemctl --user restart keymapper
fi

echo ""
echo "=== Install complete ==="
echo ""
echo "Start the daemon, now and at every login:"
echo "  systemctl --user enable --now keymapper"
echo ""
echo "Then edit your mappings in the browser. Your config lives in ~/KeyMapper —"
echo "the daemon creates it on first run, and moves an older ~/.config/keymapper"
echo "config there for you."
echo ""
echo "To uninstall:"
echo "  systemctl --user disable --now keymapper"
echo "  rm $BIN_DIR/keymapper-daemon $LAUNCHER"
echo "  rm $SERVICE_DIR/keymapper.service"
