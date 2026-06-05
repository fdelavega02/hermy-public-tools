#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-${HOME}/.openclaw}"
MAIN_WORKSPACE="${MAIN_WORKSPACE:-${OPENCLAW_HOME}/workspace}"
if [ "$#" -gt 0 ]; then
  echo "usage: auto_commit_workspace_main.sh"
  if [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
    exit 0
  fi
  exit 2
fi
exec "${SCRIPT_DIR}/auto_commit_repo.sh" "$MAIN_WORKSPACE" workspace-main
