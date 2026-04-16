# fonts/ — bundled monospace fonts with octant/sextant coverage

Three subsetted WOFF/WOFF2 files live here. All three licenses permit redistribution. See `LICENSE` for full text.

| File | Purpose | License | Source |
|---|---|---|---|
| `cascadia-mono-subset.woff2` | Primary — ASCII + Box + Block + Braille + Sextants + Octants + Latin-1 | SIL OFL 1.1 | [microsoft/cascadia-code 2404.03+](https://github.com/microsoft/cascadia-code/releases) |
| `babelstone-pseudographica-subset.woff2` | Fallback — octants + legacy computing supplement | SIL OFL 1.1 | [BabelStone Pseudographica 16.0.0](https://www.babelstone.co.uk/Fonts/Pseudographica.html) |
| `pxplus-ibm-vga8.woff` | CP437 / DOS retro mode | CC0 / Public Domain | [int10h.org PxPlus IBM VGA 8](https://int10h.org/oldschool-pc-fonts/) |

## Bundling (one-time setup)

Dependencies: `pyftsubset` from the `fonttools` package.

```bash
pip install fonttools brotli zopfli
```

### Cascadia Mono subset (~80 KB target)

```bash
# Download the source TTF
curl -L -o CascadiaMono.ttf https://github.com/microsoft/cascadia-code/releases/latest/download/CascadiaMono.ttf

# Subset to our unicode-range. Keep layout tables off — we don't use ligatures or kerning here.
pyftsubset CascadiaMono.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2500-257F,U+2580-259F,U+2800-28FF,U+1FB00-1FB3B,U+1FB70-1FB8B,U+1CC00-1CC80,U+1CD00-1CDE5" \
  --layout-features='' \
  --no-hinting \
  --desubroutinize \
  --flavor=woff2 \
  --output-file=cascadia-mono-subset.woff2
```

### BabelStone Pseudographica subset (~40 KB)

```bash
curl -L -o BabelStonePseudographica.ttf https://www.babelstone.co.uk/Fonts/Download/BabelStonePseudographica.ttf

pyftsubset BabelStonePseudographica.ttf \
  --unicodes="U+1FB00-1FB3B,U+1FB70-1FB8B,U+1CC00-1CC80,U+1CD00-1CDE5" \
  --layout-features='' \
  --no-hinting \
  --desubroutinize \
  --flavor=woff2 \
  --output-file=babelstone-pseudographica-subset.woff2
```

### PxPlus IBM VGA 8 (~25 KB)

```bash
# Already a small TTF; convert to WOFF only (no subset).
curl -L -o PxPlusIBMVGA8.ttf "https://int10h.org/oldschool-pc-fonts/download/ttf/Px437_IBM_VGA_8x16.ttf"
pyftsubset PxPlusIBMVGA8.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2500-259F" \
  --layout-features='' \
  --flavor=woff \
  --output-file=pxplus-ibm-vga8.woff
```

## Why bundled?

1. **Determinism** — offline density ordering (build-glyph-sets.py) rasters the SAME WOFF we ship at runtime, so shape vectors match byte-identically between offline and browser paths.
2. **Cross-OS/browser parity** — `textFont('monospace')` falls back to OS-specific fonts with different metrics. Bundling eliminates that variance.
3. **Octant coverage** — no mainstream OS ships an octant-capable font. Cascadia 2404.03 does; shipping it guarantees rendering.
4. **Privacy** — no CDN beacons on piece open.

## Load

CSS `@font-face` rules are generated at runtime by `scripts/lib/glyph-fonts.js` with explicit `unicode-range`. Browsers only fetch the subset required for each piece.
