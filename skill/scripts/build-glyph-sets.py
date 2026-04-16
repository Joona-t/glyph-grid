#!/usr/bin/env python3
"""build-glyph-sets.py — offline glyph rasterizer + 6D shape encoder.

For each glyph set (ASCII, braille, block, sextant, octant, etc.), rasterize
every codepoint at a canonical size (default 16x32 px) using the bundled
Cascadia Mono TTF (NOT the WOFF2 subset — freetype can't read WOFF2 without
extra conversion, and the underlying glyphs are identical). Emit a JSON
manifest with per-glyph:

    {
      "cp":     <int codepoint>,
      "s":      "<unicode char>",
      "ink":    <float in [0,1], mean alpha>,
      "vec":    [tl, tr, bl, br, hSym, vSym]  # 6D shape vector, each in [0,1]
    }

The 6D vector is Alex Harri's shape encoding (2024):
    vec[0..3] — mean ink in each quadrant of the cell (top-left, top-right,
                bottom-left, bottom-right).
    vec[4]    — horizontal symmetry: 1 - |top_ink - bottom_ink| / max(top,bot,eps)
    vec[5]    — vertical symmetry:   1 - |left_ink - right_ink| / max(left,right,eps)

At selection time the renderer samples a 6D vector from each source cell the
same way and finds the glyph whose vector is nearest.

Usage:
    python3 build-glyph-sets.py \\
        --font ../fonts/sources/CascadiaMono.ttf \\
        --out ../glyph-sets \\
        [--sets ascii braille block sextant octant asciiDense blockElements boxDrawing]

If --font is omitted and a TTF is not available, the script falls back to
Pillow's default font — results will be wrong for non-ASCII sets. Warns loud.

Determinism:
    - Cell size fixed at 16x32.
    - Pillow version pinned via requirements.txt (ships with the skill).
    - Output JSON is sorted by codepoint, formatted with indent=2.
Byte-identical output across runs is required: build once, commit JSON, never
re-raster at runtime.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import warnings
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.stderr.write("error: Pillow not installed. pip install Pillow\n")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Glyph set definitions — single source of truth for the skill.
# ---------------------------------------------------------------------------

def _range(a: int, b: int) -> list[int]:
    return list(range(a, b + 1))


SETS: dict[str, dict] = {
    "ascii": {
        "description": "Printable ASCII minus space variants. Classic ASCII art ramp.",
        "codepoints": [c for c in _range(0x21, 0x7E)],
        "include_space": True,
    },
    "asciiDense": {
        "description": "ASCII punctuation + digits + letters, dense subset.",
        "codepoints": [c for c in _range(0x21, 0x7E) if chr(c) not in ' '],
        "include_space": True,
    },
    "boxDrawing": {
        "description": "Unicode Box Drawing (U+2500–U+257F).",
        "codepoints": _range(0x2500, 0x257F),
        "include_space": True,
    },
    "blockElements": {
        "description": "Unicode Block Elements (U+2580–U+259F).",
        "codepoints": _range(0x2580, 0x259F),
        "include_space": True,
    },
    "braille": {
        "description": "Braille Patterns U+2800–U+28FF (256 glyphs).",
        "codepoints": _range(0x2800, 0x28FF),
        "include_space": False,  # U+2800 is already blank-like
    },
    "sextant": {
        "description": "Symbols for Legacy Computing — Sextants (U+1FB00–U+1FB3B).",
        "codepoints": _range(0x1FB00, 0x1FB3B),
        "include_space": True,
    },
    "octant": {
        "description": "Unicode 16 Block Octants (U+1CD00–U+1CDE5, 230 glyphs).",
        "codepoints": _range(0x1CD00, 0x1CDE5),
        "include_space": True,
    },
    "cp437": {
        "description": "CP437 printable chars — PxPlus IBM VGA 8 companion.",
        "codepoints": _range(0x20, 0x7E) + _range(0xA0, 0xFF) + _range(0x2500, 0x259F),
        "include_space": True,
    },
}


# ---------------------------------------------------------------------------
# Rasterizer.
# ---------------------------------------------------------------------------

def load_font(font_path: Path | None, size_px: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if font_path is None:
        warnings.warn(
            "no --font given; falling back to Pillow default (ASCII only). "
            "Non-ASCII sets will be tofu.",
            RuntimeWarning,
        )
        return ImageFont.load_default()
    if not font_path.exists():
        raise FileNotFoundError(f"font not found: {font_path}")
    return ImageFont.truetype(str(font_path), size_px)


def raster_glyph(ch: str, font, cell_w: int, cell_h: int) -> bytes:
    """Raster `ch` into a cell_w x cell_h L-mode bitmap. Returns bytes where
    each byte is 0–255 ink intensity (higher = more ink)."""
    img = Image.new("L", (cell_w, cell_h), color=0)
    draw = ImageDraw.Draw(img)
    try:
        bbox = draw.textbbox((0, 0), ch, font=font)
        bx, by, bX, bY = bbox
        gw, gh = bX - bx, bY - by
        # Center horizontally; vertically align baseline to ~80% of cell height.
        x = (cell_w - gw) // 2 - bx
        y = (cell_h - gh) // 2 - by
        draw.text((x, y), ch, fill=255, font=font)
    except OSError:
        # font had no glyph for this codepoint — treat as blank
        pass
    return img.tobytes()


def ink_fraction(bitmap: bytes) -> float:
    if not bitmap:
        return 0.0
    return sum(bitmap) / (len(bitmap) * 255.0)


def shape_vector(bitmap: bytes, cell_w: int, cell_h: int) -> list[float]:
    """Compute the 6D shape vector for a bitmap.

    Returns [tl, tr, bl, br, h_sym, v_sym], each in [0, 1]."""
    if not bitmap:
        return [0.0] * 6
    hw = cell_w // 2
    hh = cell_h // 2
    # Quadrant sums (over bytes 0..255).
    tl = tr = bl = br = 0
    for y in range(cell_h):
        row_off = y * cell_w
        row = bitmap[row_off : row_off + cell_w]
        for x in range(cell_w):
            v = row[x]
            if y < hh:
                if x < hw:
                    tl += v
                else:
                    tr += v
            else:
                if x < hw:
                    bl += v
                else:
                    br += v
    quad_px = hw * hh * 255.0
    tlf = tl / quad_px if quad_px else 0.0
    trf = tr / quad_px if quad_px else 0.0
    blf = bl / quad_px if quad_px else 0.0
    brf = br / quad_px if quad_px else 0.0

    top = tlf + trf
    bot = blf + brf
    left = tlf + blf
    right = trf + brf
    eps = 1e-6
    # Symmetry: 1 = fully symmetric, 0 = fully asymmetric.
    h_sym = 1.0 - abs(top - bot) / max(top, bot, eps)
    v_sym = 1.0 - abs(left - right) / max(left, right, eps)
    # Clamp defensively.
    return [
        max(0.0, min(1.0, tlf)),
        max(0.0, min(1.0, trf)),
        max(0.0, min(1.0, blf)),
        max(0.0, min(1.0, brf)),
        max(0.0, min(1.0, h_sym)),
        max(0.0, min(1.0, v_sym)),
    ]


def build_set(name: str, spec: dict, font, cell_w: int, cell_h: int) -> dict:
    glyphs = []
    cps = list(spec["codepoints"])
    if spec.get("include_space"):
        cps = [0x20] + cps
    for cp in cps:
        ch = chr(cp)
        bitmap = raster_glyph(ch, font, cell_w, cell_h)
        ink = ink_fraction(bitmap)
        vec = shape_vector(bitmap, cell_w, cell_h)
        glyphs.append({
            "cp": cp,
            "s": ch,
            "ink": round(ink, 6),
            "vec": [round(v, 6) for v in vec],
        })
    # Stable sort: primary = ink fraction ascending (classic density ramp),
    # secondary = codepoint. The shape-vector index does not rely on sort order,
    # but a density-sorted file is readable + useful for brightness-only mode.
    glyphs.sort(key=lambda g: (g["ink"], g["cp"]))
    return {
        "name": name,
        "description": spec["description"],
        "cellW": cell_w,
        "cellH": cell_h,
        "count": len(glyphs),
        "glyphs": glyphs,
    }


# ---------------------------------------------------------------------------
# CLI.
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", type=Path, default=None,
                    help="path to CascadiaMono.ttf (or any Unicode-covering monospace TTF)")
    ap.add_argument("--cp437-font", type=Path, default=None,
                    help="path to Px437_IBM_VGA_8x16.ttf (for cp437 set only)")
    ap.add_argument("--out", type=Path, required=True,
                    help="output directory for glyph-sets/*.json")
    ap.add_argument("--cell-w", type=int, default=16)
    ap.add_argument("--cell-h", type=int, default=32)
    ap.add_argument("--sets", nargs="*", default=list(SETS.keys()),
                    help="which sets to build (default: all)")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    main_font = load_font(args.font, min(args.cell_w, args.cell_h))
    cp437_font = load_font(args.cp437_font, min(args.cell_w, args.cell_h)) if args.cp437_font else main_font

    for name in args.sets:
        if name not in SETS:
            print(f"warn: unknown set '{name}', skipping", file=sys.stderr)
            continue
        font = cp437_font if name == "cp437" else main_font
        print(f"building '{name}'…")
        payload = build_set(name, SETS[name], font, args.cell_w, args.cell_h)
        out_path = args.out / f"{name}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False, sort_keys=False)
            f.write("\n")
        print(f"  {out_path}  ({payload['count']} glyphs)")

    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
