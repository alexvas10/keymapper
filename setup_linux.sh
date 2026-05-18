#!/bin/bash

# KeyMapper Linux Setup Script
# This script configures permissions for the daemon to run without sudo.

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

# 4. Load uinput module
sudo modprobe uinput

# 5. Reload udev rules
sudo udevadm control --reload-rules && sudo udevadm trigger

echo ""
echo "Setup complete!"
echo "IMPORTANT: You must LOG OUT and LOG BACK IN for the group changes to take effect."
echo "After logging back in, you can run the daemon without sudo."
