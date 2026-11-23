#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
SOURCE_DIR="$(pwd -P)"
TARGET="$HOME/.local/bin/codex-shifter"
mkdir -p "$HOME/.local/bin"
if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  if [ "$(readlink "$TARGET" 2>/dev/null || true)" != "$SOURCE_DIR/Launcher/codex-shifter" ]; then
    printf 'A different command already exists at %s; leaving it unchanged.\n' "$TARGET" >&2
    exit 1
  fi
else
  ln -s "$SOURCE_DIR/Launcher/codex-shifter" "$TARGET"
fi
printf 'Installed %s\nRun: codex-shifter\n' "$TARGET"
