# edge-aware-glyphs.md — Sobel + directional alphabet

The lightweight alternative to shape-vector selection. This is what runs when `selectionMode: "edge-directional"`.

## Method

1. Linearize sRGB source → Rec.709 luminance (CR-1: correct math).
2. Downsample to cell resolution (IM-3: Sobel on cell-res, not full-res).
3. Run 3×3 Sobel on the cell grid, emitting magnitude + direction per cell.
4. Threshold: cells below `opts.threshold` magnitude emit `opts.fallbackCp` (typically space).
5. Above threshold: bin direction into 8 compass segments, index into a directional alphabet.

The default alphabet uses Unicode Box Drawing (`─`, `╱`, `│`, `╲`) — available on every monospace font. Override via `opts.alphabet` with codepoints from your glyph set of choice (octants, arrows, etc.).

## Why Rec.709, not Rec.601?

The plan originally specified "Sobel on linearized Rec.601 luminance." This is a category error: Rec.601 weights are defined on **gamma-encoded** luma, not linear luminance. Running them on linear-light values produces slightly darker greens and lighter blues than intended.

Correct pipeline:

```
sRGB (gamma) -> sRGB EOTF (piecewise, NOT pow 2.2) -> Rec.709 weights (0.2126 R, 0.7152 G, 0.0722 B)
```

The skill's `glyph-edge.js` expects linearized input. `render.html` does the linearization once via a 256-entry LUT (`SRGB_LINEAR_LUT`), then computes luminance per pixel.

References: LearnOpenGL gamma correction; "Better sRGB to greyscale" (30fps.net); NVIDIA GPU Gems 3 Ch. 24.

## Why cell resolution (IM-3)?

If we Sobel the full-res source, gradient magnitude is dominated by aliasing patterns at frequencies smaller than a glyph cell — noise we can't represent. Downsampling to cell resolution first integrates sub-cell signal; the gradient then reflects transitions between adjacent glyph cells, which IS what a directional glyph encodes.

## Pairing

- **With XDoG prefilter (CR-7)**: XDoG turns the source into near-binary line art. Shape-vector selection collapses to ~5 glyph classes. Edge-directional selection sees each XDoG line at whatever angle it actually runs and picks the right directional glyph. Strong combination for line-stylized aesthetics.
- **With ASCII ramp**: doesn't naturally mix. Directional alphabet does what ramp alphabet can't (angle), and vice versa (density). Use `shape-edge-aware` if you want both — it encodes density via shape vector AND directional glyphs at edges.

## Configuration

```js
CONFIG.compat = "v2";
CONFIG.selectionMode = "edge-directional";
CONFIG.glyphSet = "boxDrawing";   // or any set with directional glyphs
// Alphabet override (optional) — 8 codepoints per compass bin:
// bin 0 = east, bin 2 = south (Gy positive is DOWN), bin 4 = west, bin 6 = north.
// (render.html reads GlyphGrid.edge.DEFAULT_ALPHABET unless overridden.)
```

## Limitations

- 8 directions is coarse. The box-drawing alphabet collapses to 4 unique shapes (horizontal, forward-slash, vertical, backslash) because the font has no direction-distinct NW vs SE glyphs. Use arrow glyphs (U+2190–2199) if you want 8 visually distinct bins.
- The threshold is absolute magnitude; scenes with subtle gradients need `threshold: 0.05–0.10`, scenes with sharp lines need `0.25+`.
