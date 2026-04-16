# glyph-sets.md — Unicode glyph sets supported by the skill

The v2 glyph set JSONs live in `glyph-sets/` and are produced by `scripts/build-glyph-sets.py` (font-based) or `scripts/build-glyph-sets-analytical.py` (font-free, for procedural sets). Each file is a manifest with per-glyph `{ cp, s, ink, vec }` — the 6D shape vector enables shape-vector selection.

## Sets

| Set id | Codepoints | Count | Recommended font | Notes |
|---|---|---|---|---|
| `ascii` | Paul Bourke ramp | 70 | any monospace | Brightness mode default; works without bundled fonts. |
| `asciiDense` | Dense half of Bourke ramp | 35 | any monospace | For low-contrast source material. |
| `boxDrawing` | U+2500–257F | 128 | Cascadia Mono | Line art; pairs with edge-directional selection. |
| `blockElements` | U+2580–259F | 32 | Cascadia Mono | The classic ASCII-art quad block set. |
| `braille` | U+2800–28FF | 256 | Cascadia Mono | 2×4 dot density → fine gradient. |
| `sextant` | U+1FB00–1FB3B | 60 | Cascadia Mono | 2×3 block cell; 60 of 63 (3 alias to blocks). |
| `octant` | U+1CD00–1CDE5 | 230 | Cascadia Mono 2404.03+ / BabelStone Pseudographica | Unicode 16, Sep 2024; requires bundled fonts. |
| `cp437` | U+20–7E + U+A0–FF + U+2500–259F | ≈300 | PxPlus IBM VGA 8 | DOS retro mode; chosen automatically by `retroMode: "cp437-vga"`. |

## Choosing a set

- **Maximum density, maximum palette reach**: `octant`. Requires the bundled Cascadia WOFF2 subset — no mainstream OS ships octant-capable fonts yet.
- **Portable + dense**: `braille`. Cascadia Mono ships it; system fonts usually have it too.
- **Shape fidelity**: `blockElements` + `selectionMode: "shape"`. The 32-glyph set has high shape variety (quadrant, half, shade) so shape-vector match picks meaningful glyphs.
- **Line-art emphasis**: `boxDrawing` + `selectionMode: "edge-directional"`.
- **Retro aesthetic**: pick a retro preset (`retroMode`), which selects the matching set automatically.

## Font availability cascade

At setup, `glyph-fonts.load()` detects which sets actually render. The cascade (in order of preference) is:

```
octant → sextant → braille → blockElements → asciiDense → ascii
```

If the requested set is unavailable, the loader picks the next densest available set and logs a console warning with the chosen fallback. Byte-identical rendering across browsers requires the bundled Cascadia WOFF2 — see `../fonts/README.md`.

## 6D shape vector

For each glyph:

```
vec = [tl, tr, bl, br, h_sym, v_sym]
```

- `tl/tr/bl/br`: mean ink in each quadrant of the cell, normalized to [0, 1].
- `h_sym`: horizontal symmetry `1 - |top - bot| / max(top, bot)`.
- `v_sym`: vertical symmetry `1 - |left - right| / max(left, right)`.

`glyph-shape-index.js` builds a Float32Array atlas of these vectors at setup and does O(N) brute-force nearest-neighbor per cell — fast enough in V8 at n=~256, k=6 (see CR-3 in `BUGS_AND_ITERATIONS.md`).

Harri's external-samples extension reaches 1/4 cell outside each cell to capture edge directionality. `cellVector()` takes a `reach` parameter; `selectionMode: "shape-edge-aware"` doubles it.

## Density sort

Each JSON is sorted ascending by `ink` (fraction of cell filled). This is useful for:

- Brightness-mode rendering (just use `glyphs[i].s` as the ramp).
- Picking subsets ("give me the 16 most-representative bins") via uniform stride.
- Visual inspection.

Shape-vector selection does not depend on sort order.

## Rebuilding

```bash
# Font-based (requires Cascadia Mono TTF):
bash fonts/fetch-fonts.sh  # downloads + subsets WOFFs; also grabs source TTF into /tmp
python3 scripts/build-glyph-sets.py --font /tmp/CascadiaMono.ttf --out glyph-sets

# Font-free (works anywhere Python 3 runs):
python3 scripts/build-glyph-sets-analytical.py --out glyph-sets
```

The analytical builder produces valid JSON for the procedural sets (braille, sextant, octant, blockElements, ascii, asciiDense). Font-based ASCII/box-drawing shapes depend on the font, so commit analytical ASCII only when you want font-independent metrics (brightness mode will still work perfectly).
