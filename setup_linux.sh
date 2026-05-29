#!/bin/bash
set -e

echo "Setting up KeyMapper permissions for Linux..."

# 1. Create uinput group if it doesn't exist
sudo groupadd -f uinput

# 2. Add current user to input and uinput groups
sudo usermod -aG input,uinput $USER

# 3. Create udev rules
UDEV_RULE_FILE="/etc/udev/rules.d/99-keymapper.rules"
echo "Creating udev rules in $UDEV_RULE_FILE..."

sudo bash -c "cat <<EOF > $UDEV_RULE_FILE
# Allow members of the 'uinput' group to create virtual devices
KERNEL==\"uinput\", MODE=\"0660\", GROUP=\"uinput\", OPTIONS+=\"static_node=uinput\"

# Allow members of the 'input' group to read raw input events
KERNEL==\"event*\", MODE=\"0660\", GROUP=\"input\"
EOF"

# 4. Load uinput module and persist it
sudo modprobe uinput
echo "uinput" | sudo tee /etc/modules-load.d/uinput.conf > /dev/null

# 5. Reload udev rules
sudo udevadm control --reload-rules && sudo udevadm trigger

# 6. Ensure ~/.local/bin is in PATH (needed so the daemon is findable)
if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile
    echo "Added ~/.local/bin to PATH in .bashrc and .profile"
fi

# 7. Enable systemd user lingering so the daemon survives logout (optional but useful)
loginctl enable-linger $USER 2>/dev/null || true

echo ""
echo "Setup complete!"
echo ""
echo "IMPORTANT: You must LOG OUT and LOG BACK IN for the group changes to take effect."
echo "After logging back in:"
echo "  - To build and install the app:  ./build.sh"
echo "  - Or to run the daemon directly: cargo run -p daemon"
