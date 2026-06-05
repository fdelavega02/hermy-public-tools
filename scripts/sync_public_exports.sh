#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-${HOME}/.openclaw}"
TWIN_WORKSPACE="${TWIN_WORKSPACE:-${OPENCLAW_HOME}/workspace-twin}"
MAIN_WORKSPACE="${MAIN_WORKSPACE:-${OPENCLAW_HOME}/workspace}"
HERMY_PUBLIC="${HERMY_PUBLIC:-${TWIN_WORKSPACE}/public-hermy-tools}"
HERMIONE_PUBLIC="${HERMIONE_PUBLIC:-${MAIN_WORKSPACE}/hermione-public-tools}"

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

fast_forward_repo() {
  local repo="$1"
  local label="$2"
  local branch

  branch="$(git -C "$repo" symbolic-ref --quiet --short HEAD)"
  git -C "$repo" fetch origin "$branch" >/dev/null 2>&1 || return 0
  if git -C "$repo" rev-parse --verify --quiet "origin/${branch}" >/dev/null; then
    if [ -z "$(git -C "$repo" status --porcelain)" ]; then
      git -C "$repo" merge --ff-only "origin/${branch}" >/dev/null
    elif [ "$(git -C "$repo" rev-list --right-only --count "HEAD...origin/${branch}")" != "0" ]; then
      echo "public export sync failed: ${label} has local changes and is behind origin/${branch}; manual reconciliation needed" >&2
      exit 1
    fi
  fi
}

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

fast_forward_repo "$HERMY_PUBLIC" "hermy-public-tools"
fast_forward_repo "$HERMIONE_PUBLIC" "hermione-public-tools"
sync_hermy_public
sync_hermione_public

echo "public exports synced"
