#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== KeyMapper Build ==="

if ! command -v cargo &>/dev/null; then
    echo "Error: cargo not found. Install Rust from https://rustup.rs"
    exit 1
fi

echo ""
echo "Building the daemon in release mode..."
cargo build --release -p daemon

echo ""
echo "=== Build complete ==="
echo ""
echo "Binary:"
echo "  target/release/keymapper-daemon"
echo ""
echo "To install it and register the systemd user service:"
echo "  ./install.sh"
echo ""
echo "The editor is a website and is not built here. To run it locally:"
echo "  cd gui && npm install && npm run dev"
