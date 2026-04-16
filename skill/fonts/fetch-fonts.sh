#!/bin/bash
# fetch-fonts.sh — one-shot builder for the three bundled WOFF files.
#
# Requires:
#   - Python 3.8+ with fonttools (pip install fonttools brotli zopfli)
#   - curl, unzip
#
# Run once; commit the three output WOFF files alongside this script.
# The skill's runtime (glyph-fonts.js) expects these exact filenames.
#
# Upstream distribution notes (as of 2026):
#   - Cascadia Code: Microsoft now ships only a versioned zip via GitHub releases.
#     We pin to v2407.24 and extract ttf/CascadiaMono.ttf.
#   - BabelStone: still a direct TTF download from babelstone.co.uk.
#   - PxPlus IBM VGA 8x16: int10h now ships only zipped font packs.
#     We pull the linux pack (smallest that contains TTFs) and extract
#     "ttf - Px (pixel outline)/Px437_IBM_VGA_8x16.ttf".

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

command -v pyftsubset >/dev/null 2>&1 || {
  echo "error: pyftsubset not found. pip install fonttools brotli zopfli" >&2
  exit 1
}
command -v unzip >/dev/null 2>&1 || {
  echo "error: unzip not found." >&2
  exit 1
}

CASCADIA_VER="v2407.24"
CASCADIA_URL="https://github.com/microsoft/cascadia-code/releases/download/${CASCADIA_VER}/CascadiaCode-${CASCADIA_VER#v}.zip"
BABELSTONE_URL="https://www.babelstone.co.uk/Fonts/Download/BabelStonePseudographica.ttf"
PXPLUS_PACK_URL="https://int10h.org/oldschool-pc-fonts/download/oldschool_pc_font_pack_v2.2_linux.zip"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Downloading Cascadia Code ${CASCADIA_VER}…"
curl -fsSL -o "$TMP/cascadia.zip" "$CASCADIA_URL"
echo "    extracting ttf/CascadiaMono.ttf"
unzip -p "$TMP/cascadia.zip" "ttf/CascadiaMono.ttf" > "$TMP/CascadiaMono.ttf"

echo "==> Subsetting Cascadia Mono -> cascadia-mono-subset.woff2"
pyftsubset "$TMP/CascadiaMono.ttf" \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2500-257F,U+2580-259F,U+2800-28FF,U+1FB00-1FB3B,U+1FB70-1FB8B,U+1CC00-1CC80,U+1CD00-1CDE5" \
  --layout-features='' \
  --no-hinting \
  --desubroutinize \
  --flavor=woff2 \
  --output-file=cascadia-mono-subset.woff2

echo "==> Downloading BabelStone Pseudographica…"
if curl -fsSL -o "$TMP/BabelStonePseudographica.ttf" "$BABELSTONE_URL"; then
  echo "==> Subsetting BabelStone -> babelstone-pseudographica-subset.woff2"
  pyftsubset "$TMP/BabelStonePseudographica.ttf" \
    --unicodes="U+1FB00-1FB3B,U+1FB70-1FB8B,U+1CC00-1CC80,U+1CD00-1CDE5" \
    --layout-features='' \
    --no-hinting \
    --desubroutinize \
    --flavor=woff2 \
    --output-file=babelstone-pseudographica-subset.woff2
else
  echo "warn: BabelStone download failed; skipping fallback font." >&2
fi

echo "==> Downloading int10h Oldschool PC Font Pack v2.2 (linux)…"
curl -fsSL -o "$TMP/pxplus.zip" "$PXPLUS_PACK_URL"
echo "    extracting Px437_IBM_VGA_8x16.ttf"
unzip -p "$TMP/pxplus.zip" "ttf - Px (pixel outline)/Px437_IBM_VGA_8x16.ttf" > "$TMP/Px437_IBM_VGA_8x16.ttf"

echo "==> Subsetting PxPlus IBM VGA 8 -> pxplus-ibm-vga8.woff"
pyftsubset "$TMP/Px437_IBM_VGA_8x16.ttf" \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2500-259F" \
  --layout-features='' \
  --flavor=woff \
  --output-file=pxplus-ibm-vga8.woff

echo
echo "Done. Output sizes:"
ls -lh *.woff* 2>/dev/null | awk '{print "  " $5 "\t" $9}'
echo
echo "Commit these WOFFs. Runtime loader (../scripts/lib/glyph-fonts.js)"
echo "will pick them up via @font-face unicode-range."
