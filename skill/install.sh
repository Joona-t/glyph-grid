#!/usr/bin/env bash
# Install glyph-grid as a Claude Code skill by symlinking this directory
# into ~/.claude/skills/glyph-grid. Re-running the script is safe — it
# removes any existing symlink/dir at the target before relinking.
#
# Usage:
#   bash skill/install.sh
#
# Result:
#   ~/.claude/skills/glyph-grid → <repo>/skill   (symlink)
#
# Trigger phrases like "make me an ASCII art piece with a flow field"
# or "ASCII portrait of Sparky" will auto-load the skill in a fresh
# Claude Code session after install.

set -euo pipefail

# Resolve the skill/ directory (the one this script lives in) to an
# absolute path so the symlink survives later `cd`s.
SKILL_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.claude/skills"
TARGET_LINK="${TARGET_DIR}/glyph-grid"

mkdir -p "${TARGET_DIR}"

if [[ -L "${TARGET_LINK}" ]]; then
  echo "Removing existing symlink: ${TARGET_LINK}"
  rm "${TARGET_LINK}"
elif [[ -e "${TARGET_LINK}" ]]; then
  echo "ERROR: ${TARGET_LINK} exists and is not a symlink."
  echo "Move or delete it manually, then re-run this script."
  exit 1
fi

ln -s "${SKILL_SRC}" "${TARGET_LINK}"
echo "Installed: ${TARGET_LINK} -> ${SKILL_SRC}"
echo
echo "Restart your Claude Code session to pick up the skill."
echo "Trigger with phrases like:"
echo "  - \"make me a glyph-grid piece with a flow field\""
echo "  - \"ASCII portrait of Sparky in lovespark palette\""
echo "  - \"character-grid visualization of concentric rings\""
