#!/bin/zsh
set -euo pipefail

label="com.irvin.tetrastats.tracker"
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

launchctl bootout "$domain/$label" 2>/dev/null || true
rm -f "$plist"
echo "Stopped and removed $label (tracker data was left intact)."
