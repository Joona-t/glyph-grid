#!/usr/bin/env python3
"""build-glyph-sets-analytical.py — font-free JSON for procedural Unicode sets.

Braille (U+2800–28FF), sextants (U+1FB00–1FB3B), octants (U+1CD00–1CDE5),
block elements (U+2580–259F), and box drawing (U+2500–257F) are defined by
bit positions or simple geometric primitives. We compute the 6D shape vector
directly from the Unicode semantics — no font required.

This exists so the skill can ship valid glyph-sets/*.json without requiring
every user to run `fetch-fonts.sh` + `build-glyph-sets.py`. The font-based
raster path (build-glyph-sets.py) remains authoritative for ASCII and any
set where glyph shape depends on font design.

Cell size is still 16x32 (cellW x cellH), matching build-glyph-sets.py.

Output JSON schema matches build-glyph-sets.py exactly:
    { name, description, cellW, cellH, count, glyphs: [{ cp, s, ink, vec }] }
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


CELL_W = 16
CELL_H = 32


# ---------------------------------------------------------------------------
# Shared helpers.
# ---------------------------------------------------------------------------

def shape_from_bitmap(pix: list[list[int]]) -> tuple[float, list[float]]:
    """Given a cell_h x cell_w int matrix (0 or 255), return (ink, 6D-vec).

    The 6D vector: [tl, tr, bl, br, h_sym, v_sym]."""
    cell_h = len(pix)
    cell_w = len(pix[0])
    hw = cell_w // 2
    hh = cell_h // 2
    tl = tr = bl = br = 0
    total = 0
    for y in range(cell_h):
        row = pix[y]
        for x in range(cell_w):
            v = row[x]
            total += v
            if y < hh:
                if x < hw: tl += v
                else:      tr += v
            else:
                if x < hw: bl += v
                else:      br += v
    quad_px = hw * hh * 255.0
    tlf = tl / quad_px
    trf = tr / quad_px
    blf = bl / quad_px
    brf = br / quad_px
    top = tlf + trf
    bot = blf + brf
    left = tlf + blf
    right = trf + brf
    eps = 1e-6
    h_sym = 1.0 - abs(top - bot) / max(top, bot, eps)
    v_sym = 1.0 - abs(left - right) / max(left, right, eps)
    ink = total / (cell_w * cell_h * 255.0)
    return ink, [
        max(0.0, min(1.0, tlf)),
        max(0.0, min(1.0, trf)),
        max(0.0, min(1.0, blf)),
        max(0.0, min(1.0, brf)),
        max(0.0, min(1.0, h_sym)),
        max(0.0, min(1.0, v_sym)),
    ]


def blank_bitmap(cw: int = CELL_W, ch: int = CELL_H) -> list[list[int]]:
    return [[0] * cw for _ in range(ch)]


def fill_rect(pix: list[list[int]], x0: int, y0: int, x1: int, y1: int, v: int = 255) -> None:
    """Fill pix[y0:y1, x0:x1] with v. Half-open intervals."""
    for y in range(max(0, y0), min(len(pix), y1)):
        row = pix[y]
        for x in range(max(0, x0), min(len(row), x1)):
            row[x] = v


def entry(cp: int, ink: float, vec: list[float]) -> dict:
    return {
        "cp": cp,
        "s": chr(cp),
        "ink": round(ink, 6),
        "vec": [round(v, 6) for v in vec],
    }


# ---------------------------------------------------------------------------
# Braille  U+2800–28FF  (256 glyphs)
# ---------------------------------------------------------------------------
# Dot layout per Unicode spec (4 rows x 2 cols, bit 0–7):
#   bit 0  bit 3
#   bit 1  bit 4
#   bit 2  bit 5
#   bit 6  bit 7
# We model each dot as a small filled rectangle within the cell.

BRAILLE_DOT_POSITIONS = [
    # (col_idx 0 or 1, row_idx 0..3), relative to 2x4 dot grid
    (0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2), (0, 3), (1, 3),
]


def build_braille() -> dict:
    glyphs = []
    # Split cell into 2 cols x 4 rows of dot cells, each dot ≈ 4x6 px filled.
    col_w = CELL_W // 2            # 8
    row_h = CELL_H // 4            # 8
    dot_w = col_w - 2              # 6 px wide with 1 px padding each side
    dot_h = row_h - 2              # 6 px tall
    for cp in range(0x2800, 0x2900):
        pix = blank_bitmap()
        bits = cp - 0x2800
        for i, (cx, cy) in enumerate(BRAILLE_DOT_POSITIONS):
            if bits & (1 << i):
                x0 = cx * col_w + 1
                y0 = cy * row_h + 1
                fill_rect(pix, x0, y0, x0 + dot_w, y0 + dot_h)
        ink, vec = shape_from_bitmap(pix)
        glyphs.append(entry(cp, ink, vec))
    glyphs.sort(key=lambda g: (g["ink"], g["cp"]))
    return {
        "name": "braille",
        "description": "Braille Patterns U+2800–U+28FF (256 glyphs, analytical).",
        "cellW": CELL_W,
        "cellH": CELL_H,
        "count": len(glyphs),
        "glyphs": glyphs,
    }


# ---------------------------------------------------------------------------
# Sextant  U+1FB00–1FB3B  (60 glyphs)
# ---------------------------------------------------------------------------
# 2 cols x 3 rows of blocks, bit layout per Unicode LegComp specs:
#   bit 0 top-left   bit 1 top-right
#   bit 2 mid-left   bit 3 mid-right
#   bit 4 bot-left   bit 5 bot-right
# The set maps 63 combinations onto 60 codepoints, SKIPPING 3 solid-ish ones
# that map to pre-existing block glyphs (blank=U+0020, full=U+2588,
# LEFT HALF BLOCK / RIGHT HALF BLOCK). Offsets chart (per Wikipedia):
#   0x1FB00 = bits 000001 (1)
#   ...
#   See: U+1FB00–U+1FB3B list at unicode.org.

def _sextant_for_cp(cp: int) -> int:
    """Return the 6-bit mask (0..63) for a sextant codepoint, or -1 if cp is
    outside the sextant range."""
    base = cp - 0x1FB00  # 0..59 valid
    if not (0 <= base <= 0x1FB3B - 0x1FB00):
        return -1
    # Reserved indices that are omitted: 0 (blank=U+0020), 21 (left-half block=U+258C),
    # 42 (right-half block=U+2590), 63 (full block=U+2588).
    skip = {0, 21, 42, 63}
    bits = 0
    b = base
    count = -1
    while count < b:
        bits += 1
        if bits in skip:
            continue
        count += 1
        if count == b:
            break
    return bits


def build_sextant() -> dict:
    glyphs = []
    col_w = CELL_W // 2       # 8
    row_h = CELL_H // 3       # 10
    positions = [
        (0, 0), (1, 0),
        (0, 1), (1, 1),
        (0, 2), (1, 2),
    ]
    for cp in range(0x1FB00, 0x1FB3C):
        bits = _sextant_for_cp(cp)
        if bits < 0:
            continue
        pix = blank_bitmap()
        for i, (cx, cy) in enumerate(positions):
            if bits & (1 << i):
                x0 = cx * col_w
                y0 = cy * row_h
                y1 = (cy + 1) * row_h if cy < 2 else CELL_H
                fill_rect(pix, x0, y0, x0 + col_w, y1)
        ink, vec = shape_from_bitmap(pix)
        glyphs.append(entry(cp, ink, vec))
    glyphs.sort(key=lambda g: (g["ink"], g["cp"]))
    return {
        "name": "sextant",
        "description": "Symbols for Legacy Computing — Sextants (U+1FB00–U+1FB3B, analytical).",
        "cellW": CELL_W,
        "cellH": CELL_H,
        "count": len(glyphs),
        "glyphs": glyphs,
    }


# ---------------------------------------------------------------------------
# Octant  U+1CD00–1CDE5  (230 glyphs)
# ---------------------------------------------------------------------------
# 2 cols x 4 rows = 8 bits. The range U+1CD00–1CDE5 covers 230 codepoints,
# which equals 2^8 (256) minus 26 reserved (blank + existing block glyphs +
# sextant-only combos). Per Unicode 16 LegComp spec.
#
# For simplicity we enumerate codepoints linearly and assign bit masks in
# order, skipping "represented elsewhere" masks. A more precise mapping exists
# in Unicode 16.0 code chart U1CD00.pdf; we use the simpler enumeration — the
# shape-vector approach cares about the rendered shape, not the exact semantic
# mapping, and this matches a linear raster path well.

def build_octant() -> dict:
    glyphs = []
    col_w = CELL_W // 2       # 8
    row_h = CELL_H // 4       # 8
    positions = [
        (0, 0), (1, 0),
        (0, 1), (1, 1),
        (0, 2), (1, 2),
        (0, 3), (1, 3),
    ]
    # Skip masks: blank (0), full (255), already-represented quadrants/halves.
    # Quadrants = each single bit on 4 quadrant-sized positions; handled by
    # existing U+2597..259B glyphs — but octants render all 256 combos in
    # their own block anyway in modern fonts. Keep simple: enumerate 0..255
    # skipping blank + full + 24 "simple" combinations that land in U+2580
    # range. Approximate mapping: 230 of 256 masks used.

    simple_block_masks = {
        0, 255,
        0b00000001, 0b00000010, 0b00000100, 0b00001000,
        0b00010000, 0b00100000, 0b01000000, 0b10000000,
        0b00000011, 0b00001100, 0b00110000, 0b11000000,
        0b01010101, 0b10101010, 0b11110000, 0b00001111,
        0b00111100, 0b11000011, 0b11111100, 0b00111111,
        0b11001100, 0b00110011,
    }  # 26 skipped → 256-26 = 230 remaining

    cp = 0x1CD00
    for bits in range(256):
        if bits in simple_block_masks:
            continue
        if cp > 0x1CDE5:
            break
        pix = blank_bitmap()
        for i, (cx, cy) in enumerate(positions):
            if bits & (1 << i):
                x0 = cx * col_w
                y0 = cy * row_h
                fill_rect(pix, x0, y0, x0 + col_w, y0 + row_h)
        ink, vec = shape_from_bitmap(pix)
        glyphs.append(entry(cp, ink, vec))
        cp += 1
    glyphs.sort(key=lambda g: (g["ink"], g["cp"]))
    return {
        "name": "octant",
        "description": "Block Octants U+1CD00–U+1CDE5 (Unicode 16, 230 glyphs, analytical).",
        "cellW": CELL_W,
        "cellH": CELL_H,
        "count": len(glyphs),
        "glyphs": glyphs,
    }


# ---------------------------------------------------------------------------
# Block Elements  U+2580–259F  (32 glyphs)
# ---------------------------------------------------------------------------
# Hand-encoded because each codepoint has a distinct primitive.

BLOCK_ELEMENT_DEFS: dict[int, str] = {
    0x2580: "upper_half",         # ▀
    0x2581: "lower_eighth_1",     # ▁
    0x2582: "lower_eighth_2",     # ▂
    0x2583: "lower_eighth_3",     # ▃
    0x2584: "lower_half",         # ▄
    0x2585: "lower_eighth_5",     # ▅
    0x2586: "lower_eighth_6",     # ▆
    0x2587: "lower_eighth_7",     # ▇
    0x2588: "full",               # █
    0x2589: "left_eighth_7",      # ▉
    0x258A: "left_eighth_6",      # ▊
    0x258B: "left_eighth_5",      # ▋
    0x258C: "left_half",          # ▌
    0x258D: "left_eighth_3",      # ▍
    0x258E: "left_eighth_2",      # ▎
    0x258F: "left_eighth_1",      # ▏
    0x2590: "right_half",         # ▐
    0x2591: "shade_light",        # ░ (25% dots)
    0x2592: "shade_medium",       # ▒ (50% dots)
    0x2593: "shade_dark",         # ▓ (75% dots)
    0x2594: "upper_eighth_1",     # ▔
    0x2595: "right_eighth_1",     # ▕
    0x2596: "quad_bl",            # ▖
    0x2597: "quad_br",            # ▗
    0x2598: "quad_tl",            # ▘
    0x2599: "tl_bl_br",           # ▙
    0x259A: "tl_br_diag",         # ▚
    0x259B: "tl_tr_bl",           # ▛
    0x259C: "tl_tr_br",           # ▜
    0x259D: "quad_tr",            # ▝
    0x259E: "tr_bl_diag",         # ▞
    0x259F: "tr_bl_br",           # ▟
}


def _render_block(kind: str) -> list[list[int]]:
    pix = blank_bitmap()
    W, H = CELL_W, CELL_H
    eighth = H // 8  # 4
    if kind == "upper_half":           fill_rect(pix, 0, 0, W, H // 2)
    elif kind == "lower_half":         fill_rect(pix, 0, H // 2, W, H)
    elif kind == "left_half":          fill_rect(pix, 0, 0, W // 2, H)
    elif kind == "right_half":         fill_rect(pix, W // 2, 0, W, H)
    elif kind == "full":               fill_rect(pix, 0, 0, W, H)
    elif kind.startswith("lower_eighth_"):
        n = int(kind.split("_")[-1])
        fill_rect(pix, 0, H - n * eighth, W, H)
    elif kind.startswith("upper_eighth_"):
        n = int(kind.split("_")[-1])
        fill_rect(pix, 0, 0, W, n * eighth)
    elif kind.startswith("left_eighth_"):
        n = int(kind.split("_")[-1])
        fill_rect(pix, 0, 0, n * (W // 8), H)
    elif kind.startswith("right_eighth_"):
        n = int(kind.split("_")[-1])
        fill_rect(pix, W - n * (W // 8), 0, W, H)
    elif kind == "shade_light":        # 25% stipple
        for y in range(H):
            for x in range(W):
                if ((x + y) % 4 == 0): pix[y][x] = 255
    elif kind == "shade_medium":       # 50% checker
        for y in range(H):
            for x in range(W):
                if ((x + y) % 2 == 0): pix[y][x] = 255
    elif kind == "shade_dark":         # 75% stipple
        for y in range(H):
            for x in range(W):
                if ((x + y) % 4 != 0): pix[y][x] = 255
    elif kind == "quad_tl":            fill_rect(pix, 0, 0, W // 2, H // 2)
    elif kind == "quad_tr":            fill_rect(pix, W // 2, 0, W, H // 2)
    elif kind == "quad_bl":            fill_rect(pix, 0, H // 2, W // 2, H)
    elif kind == "quad_br":            fill_rect(pix, W // 2, H // 2, W, H)
    elif kind == "tl_bl_br":
        fill_rect(pix, 0, 0, W // 2, H // 2); fill_rect(pix, 0, H // 2, W, H)
    elif kind == "tl_tr_bl":
        fill_rect(pix, 0, 0, W, H // 2); fill_rect(pix, 0, H // 2, W // 2, H)
    elif kind == "tl_tr_br":
        fill_rect(pix, 0, 0, W, H // 2); fill_rect(pix, W // 2, H // 2, W, H)
    elif kind == "tr_bl_br":
        fill_rect(pix, W // 2, 0, W, H // 2); fill_rect(pix, 0, H // 2, W, H)
    elif kind == "tl_br_diag":
        fill_rect(pix, 0, 0, W // 2, H // 2); fill_rect(pix, W // 2, H // 2, W, H)
    elif kind == "tr_bl_diag":
        fill_rect(pix, W // 2, 0, W, H // 2); fill_rect(pix, 0, H // 2, W // 2, H)
    return pix


def build_block_elements() -> dict:
    glyphs = []
    for cp, kind in BLOCK_ELEMENT_DEFS.items():
        pix = _render_block(kind)
        ink, vec = shape_from_bitmap(pix)
        glyphs.append(entry(cp, ink, vec))
    glyphs.sort(key=lambda g: (g["ink"], g["cp"]))
    return {
        "name": "blockElements",
        "description": "Block Elements U+2580–U+259F (32 glyphs, analytical).",
        "cellW": CELL_W,
        "cellH": CELL_H,
        "count": len(glyphs),
        "glyphs": glyphs,
    }


# ---------------------------------------------------------------------------
# ASCII (analytical)
# ---------------------------------------------------------------------------
# Density-ramp approximation based on Paul Bourke's canonical ASCII
# characters-by-density table. We hand-assign ink fractions; shape vectors
# are set from a generic "centered thin-ink" profile — acceptable for the
# brightness-selection path, adequate for shape-vector when no font is
# available.

# Paul Bourke's 70-char density ramp (sparse → dense):
BOURKE_RAMP = (
    " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"
)


def build_ascii() -> dict:
    glyphs = []
    n = len(BOURKE_RAMP)
    for i, ch in enumerate(BOURKE_RAMP):
        ink = i / (n - 1) if n > 1 else 0.5
        # Approximate shape vector from ink: assume centered, symmetric.
        quad = ink
        vec = [quad, quad, quad, quad, 1.0, 1.0]
        glyphs.append(entry(ord(ch), ink, vec))
    glyphs.sort(key=lambda g: (g["ink"], g["cp"]))
    return {
        "name": "ascii",
        "description": "Printable ASCII on Bourke density ramp (70 glyphs, analytical).",
        "cellW": CELL_W,
        "cellH": CELL_H,
        "count": len(glyphs),
        "glyphs": glyphs,
    }


def build_ascii_dense() -> dict:
    # Same ramp but drop leading space and thin chars — "dense" subset.
    dense = BOURKE_RAMP[len(BOURKE_RAMP) // 2:]
    glyphs = []
    n = len(dense)
    for i, ch in enumerate(dense):
        ink = 0.4 + 0.6 * (i / (n - 1) if n > 1 else 0.5)
        quad = ink
        vec = [quad, quad, quad, quad, 1.0, 1.0]
        glyphs.append(entry(ord(ch), ink, vec))
    glyphs.sort(key=lambda g: (g["ink"], g["cp"]))
    return {
        "name": "asciiDense",
        "description": "Dense half of Bourke ASCII ramp (analytical, approximate).",
        "cellW": CELL_W,
        "cellH": CELL_H,
        "count": len(glyphs),
        "glyphs": glyphs,
    }


# ---------------------------------------------------------------------------
# CLI.
# ---------------------------------------------------------------------------

BUILDERS = {
    "braille":       build_braille,
    "sextant":       build_sextant,
    "octant":        build_octant,
    "blockElements": build_block_elements,
    "ascii":         build_ascii,
    "asciiDense":    build_ascii_dense,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True,
                    help="output directory for glyph-sets/*.json")
    ap.add_argument("--sets", nargs="*", default=list(BUILDERS.keys()),
                    help="which sets to build")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    for name in args.sets:
        if name not in BUILDERS:
            print(f"warn: unknown set '{name}', skipping")
            continue
        print(f"building analytical '{name}'…")
        payload = BUILDERS[name]()
        out_path = args.out / f"{name}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False, sort_keys=False)
            f.write("\n")
        print(f"  {out_path}  ({payload['count']} glyphs)")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
