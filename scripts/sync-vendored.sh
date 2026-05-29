#!/usr/bin/env bash
# Refresh vendored superpowers skills from upstream.
# Run manually before each casa-ready release; eyeball the diff for behavioral changes.
set -euo pipefail

UPSTREAM="${1:-$HOME/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/plugin/skills/_vendored"

if [ ! -d "$UPSTREAM" ]; then
  echo "Upstream superpowers skills directory not found: $UPSTREAM" >&2
  echo "Pass the actual path as argv[1] if your install location differs." >&2
  exit 1
fi

mkdir -p "$DEST"

for skill in systematic-debugging test-driven-development; do
  SRC="$UPSTREAM/$skill"
  if [ ! -d "$SRC" ]; then
    echo "Source skill not found: $SRC" >&2
    exit 1
  fi
  rm -rf "$DEST/$skill"
  cp -R "$SRC" "$DEST/$skill"
  echo "Refreshed $skill from $SRC"
done

echo ""
echo "Done. Now diff against the previous version and commit if behavior changes look safe:"
echo "  git diff plugin/skills/_vendored/"
