#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== KeyMapper Build ==="

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

echo ""
echo "Building everything in release mode..."
cargo build --release

echo ""
echo "=== Build complete ==="
echo ""
echo "Binaries:"
echo "  target/release/keymapper-gui"
echo "  target/release/keymapper-daemon"
echo ""
echo "To install KeyMapper (creates launcher entry):"
echo "  ./install.sh"
