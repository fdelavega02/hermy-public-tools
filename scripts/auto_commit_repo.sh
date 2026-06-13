#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: auto_commit_repo.sh <repo-path> <repo-label>"
}

if [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
  usage
  exit 0
fi

if [ "$#" -lt 2 ]; then
  usage
  exit 2
fi

REPO="$1"
LABEL="$2"
cd "$REPO"

LOCK_DIR=".git/auto-commit.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "auto-commit skipped: another run is active for ${LABEL}"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

if [ -e .git/MERGE_HEAD ] || [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -e .git/CHERRY_PICK_HEAD ] || [ -e .git/REVERT_HEAD ]; then
  echo "auto-commit skipped: git operation in progress for ${LABEL}"
  exit 0
fi

branch="$(git symbolic-ref --quiet --short HEAD)"

# Refresh remote state before committing. If the remote is ahead and there are
# local changes, stop instead of creating an automatic conflict.
git fetch origin "$branch" >/dev/null 2>&1 || true
if git rev-parse --verify --quiet "origin/${branch}" >/dev/null; then
  ahead_behind="$(git rev-list --left-right --count "HEAD...origin/${branch}")"
  ahead="${ahead_behind%%$'\t'*}"
  behind="${ahead_behind##*$'\t'}"
  if [ "${behind}" != "0" ]; then
    if [ -n "$(git status --porcelain)" ]; then
      echo "auto-commit failed: ${LABEL} is behind origin/${branch} by ${behind} commit(s) and has local changes; manual rebase/merge needed"
      exit 1
    fi
    git merge --ff-only "origin/${branch}"
  fi
fi

if [ -z "$(git status --porcelain)" ]; then
  # Still push if local is ahead but tree is clean.
  if git rev-parse --verify --quiet "origin/${branch}" >/dev/null; then
    ahead_behind="$(git rev-list --left-right --count "HEAD...origin/${branch}")"
    ahead="${ahead_behind%%$'\t'*}"
    if [ "${ahead}" != "0" ]; then
      git push origin "$branch"
      echo "auto-commit: pushed ${ahead} pending commit(s) for ${LABEL}"
      exit 0
    fi
  fi
  echo "auto-commit: no changes for ${LABEL}"
  exit 0
fi

git add -A

if git diff --cached --quiet; then
  echo "auto-commit: no staged changes for ${LABEL}"
  exit 0
fi

case "$LABEL" in
  hermy-public-tools|hermione-public-tools|Hermy-TV)
    major_public_change=0
    while IFS=$'\t' read -r status _path _rest; do
      case "$status" in
        A*|D*|R*|C*)
          major_public_change=1
          break
          ;;
      esac
    done < <(git diff --cached --name-status)

    if [ "$major_public_change" = "1" ] && ! git diff --cached --name-only -- README.md | grep -q '^README\.md$'; then
      echo "auto-commit failed: ${LABEL} has a major public repo change but README.md was not updated; coordinate with the owner and refresh the README before pushing"
      exit 1
    fi
    ;;
esac

STAMP="$(TZ=America/Indianapolis date '+%Y-%m-%d %H:%M %Z')"
git commit -m "Auto-commit pending changes (${LABEL}, ${STAMP})"
git push origin "$branch"

echo "auto-commit: committed and pushed $(git rev-parse --short HEAD) for ${LABEL}"
