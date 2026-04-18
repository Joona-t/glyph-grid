#!/usr/bin/env bash
# export-gif.sh — stitch a directory of frame_NNNN.png files into a looping GIF.
#
# Usage:
#   ./export-gif.sh <frames_dir> [output.gif] [fps]
#
# Defaults:
#   frames_dir = frames
#   output.gif = out.gif
#   fps        = 30
#
# Strategy: two-pass palette generation (palettegen + paletteuse).
# Default ffmpeg GIF encoding uses a global 256-color web palette and looks
# muddy; palettegen analyzes the actual frames to build a custom palette,
# then paletteuse maps each frame against it. Bayer dither stays sharp on
# character-grid output (no error-diffusion smearing).

set -euo pipefail

FRAMES_DIR="${1:-frames}"
OUT="${2:-out.gif}"
FPS="${3:-30}"

if [[ ! -d "$FRAMES_DIR" ]]; then
  echo "error: frames dir '$FRAMES_DIR' does not exist or is not a directory" >&2
  echo "" >&2
  echo "Usage: $0 <frames_dir> [output.gif] [fps]" >&2
  exit 1
fi

if ! ls "$FRAMES_DIR"/frame_????.png >/dev/null 2>&1; then
  echo "error: no frame_NNNN.png files found in '$FRAMES_DIR'" >&2
  echo "expected files like frame_0001.png, frame_0002.png, …" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg not found in PATH" >&2
  echo "install from https://ffmpeg.org/download.html" >&2
  exit 1
fi

PALETTE="$(mktemp -t glyph-grid-palette-XXXXXX).png"
trap 'rm -f "$PALETTE"' EXIT

echo "→ generating palette from $FRAMES_DIR/frame_*.png"
ffmpeg -y -loglevel warning \
  -framerate "$FPS" -i "$FRAMES_DIR/frame_%04d.png" \
  -vf "fps=$FPS,scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,palettegen=stats_mode=diff" \
  "$PALETTE"

echo "→ stitching $OUT @ ${FPS}fps"
ffmpeg -y -loglevel warning \
  -framerate "$FPS" -i "$FRAMES_DIR/frame_%04d.png" -i "$PALETTE" \
  -lavfi "fps=$FPS,scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  -loop 0 \
  "$OUT"

bytes=$(wc -c < "$OUT" 2>/dev/null || stat -c%s "$OUT" 2>/dev/null || echo "?")
echo "✓ wrote $OUT (${bytes} bytes)"
