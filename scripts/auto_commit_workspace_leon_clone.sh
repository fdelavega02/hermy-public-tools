#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-${HOME}/.openclaw}"
LEON_CLONE_WORKSPACE="${LEON_CLONE_WORKSPACE:-${OPENCLAW_HOME}/workspace-leon-clone}"
if [ "$#" -gt 0 ]; then
  echo "usage: auto_commit_workspace_leon_clone.sh"
  if [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
    exit 0
  fi
  exit 2
fi
exec "${SCRIPT_DIR}/auto_commit_repo.sh" "$LEON_CLONE_WORKSPACE" workspace-leon-clone
