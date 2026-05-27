#!/usr/bin/env bash
set -euo pipefail

cd /home/fdelavega02/.openclaw/workspace-twin/social/linkedin-local
npm run post-approved -- "$@"
