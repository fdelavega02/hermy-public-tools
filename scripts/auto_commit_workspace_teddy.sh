#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-${HOME}/.openclaw}"
TEDDY_WORKSPACE="${TEDDY_WORKSPACE:-${OPENCLAW_HOME}/workspace-teddy}"
if [ "$#" -gt 0 ]; then
  echo "usage: auto_commit_workspace_teddy.sh"
  if [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
    exit 0
  fi
  exit 2
fi
exec "${SCRIPT_DIR}/auto_commit_repo.sh" "$TEDDY_WORKSPACE" workspace-teddy
