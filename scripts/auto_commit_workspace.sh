#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERIC="${SCRIPT_DIR}/auto_commit_repo.sh"
SYNC_PUBLIC_EXPORTS="${SCRIPT_DIR}/sync_public_exports.sh"
OPENCLAW_HOME="${OPENCLAW_HOME:-${HOME}/.openclaw}"
TWIN_WORKSPACE="${TWIN_WORKSPACE:-${OPENCLAW_HOME}/workspace-twin}"
MAIN_WORKSPACE="${MAIN_WORKSPACE:-${OPENCLAW_HOME}/workspace}"
TEDDY_WORKSPACE="${TEDDY_WORKSPACE:-${OPENCLAW_HOME}/workspace-teddy}"
LEON_CLONE_WORKSPACE="${LEON_CLONE_WORKSPACE:-${OPENCLAW_HOME}/workspace-leon-clone}"
HERMY_PUBLIC="${HERMY_PUBLIC:-${TWIN_WORKSPACE}/public-hermy-tools}"
HERMIONE_PUBLIC="${HERMIONE_PUBLIC:-${MAIN_WORKSPACE}/hermione-public-tools}"

usage() {
  echo "usage: auto_commit_workspace.sh"
}

if [ "$#" -gt 0 ]; then
  if [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
    usage
    exit 0
  fi
  usage
  exit 2
fi

run_one() {
  local repo="$1"
  local label="$2"
  echo "=== ${label} ==="
  if "${GENERIC}" "${repo}" "${label}"; then
    return 0
  else
    echo "auto-commit failed for ${label}"
    return 1
  fi
}

failures=0
if "${SYNC_PUBLIC_EXPORTS}"; then
  echo "public export sync completed"
else
  echo "public export sync failed"
  failures=$((failures + 1))
fi

run_one "$TWIN_WORKSPACE" "workspace-twin" || failures=$((failures + 1))
run_one "$MAIN_WORKSPACE" "workspace-main" || failures=$((failures + 1))
run_one "$TEDDY_WORKSPACE" "workspace-teddy" || failures=$((failures + 1))
run_one "$LEON_CLONE_WORKSPACE" "workspace-leon-clone" || failures=$((failures + 1))
run_one "$HERMY_PUBLIC" "hermy-public-tools" || failures=$((failures + 1))
run_one "$HERMIONE_PUBLIC" "hermione-public-tools" || failures=$((failures + 1))

if [ "$failures" -ne 0 ]; then
  echo "auto-commit completed with ${failures} failure(s)"
  exit 1
fi

echo "auto-commit: all configured workspaces checked"
