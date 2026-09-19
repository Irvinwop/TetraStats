#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
repo_root="${script_dir:h:h}"
tracker_dir="$repo_root/tracker"

if [[ -f "$repo_root/.env" ]]; then
  set -a
  source "$repo_root/.env"
  set +a
fi

export TRACK_USERNAME="${TRACK_USERNAME:-Irvinwop}"
export TRACK_PLAYER_ID="${TRACK_PLAYER_ID:-678656e79f48dae00cefd822}"
export TRACK_STREAMS="${TRACK_STREAMS:-league,40l,blitz,zenith,zenithex}"
export POLL_INTERVAL_MS="${POLL_INTERVAL_MS:-300000}"
export BACKFILL_MAX_PAGES="${BACKFILL_MAX_PAGES:-100}"
export PROCESS_BATCH_SIZE="${PROCESS_BATCH_SIZE:-25}"
export REPLAY_SOURCE="${REPLAY_SOURCE:-auto}"
export MINOMUNCHER_URL="${MINOMUNCHER_URL:-https://minomuncher.com}"
export TRACKER_HOST="${TRACKER_HOST:-127.0.0.1}"
export PORT="${PORT:-8080}"
export DATA_DIR="${DATA_DIR:-$repo_root/data}"
default_web_root="$repo_root/web"
if [[ -f "$repo_root/build/web/index.html" ]]; then
  default_web_root="$repo_root/build/web"
fi
export WEB_ROOT="${WEB_ROOT:-$default_web_root}"

bun_bin="${BUN_BIN:-}"
if [[ -z "$bun_bin" ]]; then
  if [[ -x "$HOME/.bun/bin/bun" ]]; then
    bun_bin="$HOME/.bun/bin/bun"
  elif [[ -x /opt/homebrew/bin/bun ]]; then
    bun_bin=/opt/homebrew/bin/bun
  else
    bun_bin="$(command -v bun)"
  fi
fi

mkdir -p "$DATA_DIR"
cd "$tracker_dir"
exec "$bun_bin" run src/index.ts
