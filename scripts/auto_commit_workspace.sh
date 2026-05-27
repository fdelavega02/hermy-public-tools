#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERIC="${SCRIPT_DIR}/auto_commit_repo.sh"

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
run_one "/home/fdelavega02/.openclaw/workspace-twin" "workspace-twin" || failures=$((failures + 1))
run_one "/home/fdelavega02/.openclaw/workspace" "workspace-main" || failures=$((failures + 1))
run_one "/home/fdelavega02/.openclaw/workspace-teddy" "workspace-teddy" || failures=$((failures + 1))
run_one "/home/fdelavega02/.openclaw/workspace-leon-clone" "workspace-leon-clone" || failures=$((failures + 1))

if [ "$failures" -ne 0 ]; then
  echo "auto-commit completed with ${failures} failure(s)"
  exit 1
fi

echo "auto-commit: all configured workspaces checked"
