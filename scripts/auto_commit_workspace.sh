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
HERMY_TV_PUBLIC="${HERMY_TV_PUBLIC:-${HOME}/Hermy-TV}"
PUBLIC_COORDINATION_DONE="${AUTO_COMMIT_PUBLIC_COORDINATION_DONE:-0}"

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

repo_has_pending_public_push() {
  local repo="$1"
  local branch ahead_behind ahead

  if [ ! -d "${repo}/.git" ]; then
    return 1
  fi

  if [ -n "$(git -C "$repo" status --porcelain)" ]; then
    return 0
  fi

  branch="$(git -C "$repo" symbolic-ref --quiet --short HEAD)"
  git -C "$repo" fetch origin "$branch" >/dev/null 2>&1 || true
  if git -C "$repo" rev-parse --verify --quiet "origin/${branch}" >/dev/null; then
    ahead_behind="$(git -C "$repo" rev-list --left-right --count "HEAD...origin/${branch}")"
    ahead="${ahead_behind%%$'\t'*}"
    if [ "${ahead}" != "0" ]; then
      return 0
    fi
  fi

  return 1
}

coordinate_public_repo_pushes() {
  local labels=()
  local joined

  repo_has_pending_public_push "$HERMY_PUBLIC" && labels+=("hermy-public-tools")
  repo_has_pending_public_push "$HERMIONE_PUBLIC" && labels+=("hermione-public-tools")
  repo_has_pending_public_push "$HERMY_TV_PUBLIC" && labels+=("Hermy-TV")

  if [ "${#labels[@]}" -eq 0 ]; then
    echo "public repo coordination: no pending public pushes"
    return 0
  fi

  if [ "$PUBLIC_COORDINATION_DONE" = "1" ]; then
    echo "public repo coordination: already completed for ${labels[*]}"
    return 0
  fi

  if ! command -v openclaw >/dev/null 2>&1; then
    echo "public repo coordination failed: openclaw CLI is unavailable; ask Hermione and Hermy-TV before pushing public repos" >&2
    return 1
  fi

  joined="${labels[*]}"
  echo "public repo coordination: asking Hermione and Hermy-TV before pushing ${joined}"
  openclaw agent --agent main --timeout 300 --message "Hermy-Own's nightly public repo upkeep has pending public pushes for: ${joined}. Before she pushes, Francisco wants both Hermione and Hermy-TV asked whether there are new projects or public-safe work that should be exported into the public repos. If you have something for hermione-public-tools, update that public repo now and write your own README.md update too when it is a major change, including adding a new file/folder, changing scope, examples, usage, boundaries, or project status. If there is nothing new, say that plainly. Keep the reply brief."
  openclaw agent --agent twitch --timeout 300 --message "Hermy-Own's nightly public repo upkeep has pending public pushes for: ${joined}. Before she pushes, Francisco wants both Hermy-TV and Hermione asked whether there are new projects or public-safe work that should be exported into the public repos. If you have something for Hermy-TV, update /home/fdelavega02/Hermy-TV now and write your own README.md update too when it is a major change, including adding a new file/folder, changing stream-event support, OBS/TTS behavior, examples, usage, boundaries, or project status. If there is nothing new, say that plainly. Keep the reply brief."
  echo "public repo coordination: owner check completed"
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
if ! coordinate_public_repo_pushes; then
  failures=$((failures + 1))
  echo "auto-commit completed with ${failures} failure(s)"
  exit 1
fi
run_one "$HERMY_PUBLIC" "hermy-public-tools" || failures=$((failures + 1))
run_one "$HERMIONE_PUBLIC" "hermione-public-tools" || failures=$((failures + 1))
run_one "$HERMY_TV_PUBLIC" "Hermy-TV" || failures=$((failures + 1))

if [ "$failures" -ne 0 ]; then
  echo "auto-commit completed with ${failures} failure(s)"
  exit 1
fi

echo "auto-commit: all configured workspaces checked"
