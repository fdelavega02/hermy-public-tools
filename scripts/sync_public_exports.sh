#!/usr/bin/env bash
set -euo pipefail

TWIN_WORKSPACE="/home/fdelavega02/.openclaw/workspace-twin"
MAIN_WORKSPACE="/home/fdelavega02/.openclaw/workspace"
HERMY_PUBLIC="${TWIN_WORKSPACE}/public-hermy-tools"
HERMIONE_PUBLIC="${MAIN_WORKSPACE}/hermione-public-tools"

require_dir() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    echo "missing required directory: $dir" >&2
    exit 1
  fi
}

require_dir "$TWIN_WORKSPACE/scripts"
require_dir "$TWIN_WORKSPACE/social/linkedin-local"
require_dir "$TWIN_WORKSPACE/automation/spotify-ptt-bridge"
require_dir "$HERMY_PUBLIC/.git"
require_dir "$MAIN_WORKSPACE/scripts"
require_dir "$MAIN_WORKSPACE/mail/outlook-local"
require_dir "$HERMIONE_PUBLIC/.git"

sync_hermy_public() {
  mkdir -p "$HERMY_PUBLIC/scripts" "$HERMY_PUBLIC/social/linkedin-local" "$HERMY_PUBLIC/automation/spotify-ptt-bridge"

  rsync -a --delete \
    --exclude='leon_talia_daily_verbatim.py' \
    "$TWIN_WORKSPACE/scripts/" "$HERMY_PUBLIC/scripts/"

  rsync -a --delete \
    --exclude='config.json' \
    --exclude='node_modules/' \
    --exclude='output/' \
    --exclude='state/' \
    "$TWIN_WORKSPACE/social/linkedin-local/" "$HERMY_PUBLIC/social/linkedin-local/"


  rsync -a --delete \
    --exclude='config.json' \
    --exclude='node_modules/' \
    --exclude='state/' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    "$TWIN_WORKSPACE/automation/spotify-ptt-bridge/" "$HERMY_PUBLIC/automation/spotify-ptt-bridge/"
}

sync_hermione_public() {
  mkdir -p "$HERMIONE_PUBLIC/scripts" "$HERMIONE_PUBLIC/mail/outlook-local"

  rsync -a --delete \
    "$MAIN_WORKSPACE/scripts/" "$HERMIONE_PUBLIC/scripts/"
  chmod +x "$HERMIONE_PUBLIC"/scripts/*.sh

  rsync -a --delete \
    --exclude='config.json' \
    --exclude='node_modules/' \
    --exclude='output/' \
    --exclude='state/' \
    --exclude='.tmp-*' \
    "$MAIN_WORKSPACE/mail/outlook-local/" "$HERMIONE_PUBLIC/mail/outlook-local/"
}

sync_hermy_public
sync_hermione_public

echo "public exports synced"
