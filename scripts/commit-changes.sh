#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

# Include new, modified, and deleted files, keeping the local PR draft out.
git add -A -- . ':(top,exclude)PR.md'
if ! git diff --cached --quiet -- PR.md; then
  git restore --staged -- PR.md
fi

git commit -m "${1:-Add cascading web filters and bump version to 0.7.0}"
# Intentionally do not push.
