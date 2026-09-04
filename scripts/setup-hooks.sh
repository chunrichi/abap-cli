#!/usr/bin/env bash
# Wire .githooks/ as the active git hooks directory.
# Idempotent — safe to re-run.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
hooks_dir="$repo_root/.githooks"

if [[ ! -d "$hooks_dir" ]]; then
  echo "✗ .githooks/ not found at $hooks_dir" >&2
  exit 1
fi

# Make all hook scripts executable (in case they were cloned without +x).
chmod +x "$hooks_dir"/*

git config core.hooksPath "$hooks_dir"
echo "✓ core.hooksPath = $hooks_dir"
echo "  Pre-push hook will now run \`npm run verify\` before every push."
echo "  Escape hatch: git push --no-verify"
