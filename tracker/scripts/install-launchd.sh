#!/bin/zsh
set -euo pipefail

label="com.irvin.tetrastats.tracker"
script_dir="${0:A:h}"
repo_root="${script_dir:h:h}"
runtime_root="$HOME/Library/Application Support/TetraStats"
runtime_tracker="$runtime_root/tracker"
runner="$runtime_tracker/scripts/run-local.sh"
launch_agents="$HOME/Library/LaunchAgents"
plist="$launch_agents/$label.plist"
log_dir="$runtime_root/data"
domain="gui/$(id -u)"
bun_bin="${BUN_BIN:-$HOME/.bun/bin/bun}"

if [[ ! -x "$bun_bin" ]]; then
  bun_bin="$(command -v bun)"
fi

mkdir -p "$launch_agents" "$log_dir" "$runtime_tracker"
rsync -a --delete \
  --exclude node_modules \
  --exclude test \
  "$repo_root/tracker/" "$runtime_tracker/"
if [[ -f "$repo_root/.env" ]]; then
  cp "$repo_root/.env" "$runtime_root/.env"
  chmod 600 "$runtime_root/.env"
fi
chmod +x "$runner"

(
  cd "$runtime_tracker"
  "$bun_bin" install --frozen-lockfile --production
)

plutil -create xml1 "$plist"
plutil -insert Label -string "$label" "$plist"
plutil -insert ProgramArguments -array "$plist"
plutil -insert ProgramArguments.0 -string "$runner" "$plist"
plutil -insert WorkingDirectory -string "$runtime_tracker" "$plist"
plutil -insert RunAtLoad -bool true "$plist"
plutil -insert KeepAlive -bool true "$plist"
plutil -insert ThrottleInterval -integer 10 "$plist"
plutil -insert ProcessType -string Background "$plist"
plutil -insert StandardOutPath -string "$log_dir/tracker.out.log" "$plist"
plutil -insert StandardErrorPath -string "$log_dir/tracker.err.log" "$plist"
plutil -insert EnvironmentVariables -dictionary "$plist"
plutil -insert EnvironmentVariables.BUN_BIN -string "$bun_bin" "$plist"

launchctl bootout "$domain/$label" 2>/dev/null || true
launchctl bootstrap "$domain" "$plist"
launchctl enable "$domain/$label"
launchctl kickstart -k "$domain/$label"

echo "Installed and started $label"
echo "Dashboard: http://127.0.0.1:8080"
echo "Logs: $log_dir/tracker.out.log and $log_dir/tracker.err.log"
echo "Runtime: $runtime_root"
