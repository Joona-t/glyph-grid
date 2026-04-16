# palette-morph.md — OKLab palette interpolation

## Purpose

Animate the palette across the loop. Linear sRGB blends produce muddy midpoints (magenta → cyan goes through grey); linear sRGB-gamma blends shift hue incorrectly. OKLab interpolation preserves perceived lightness and hue.

## Math

1. Parse sRGB hex → linear sRGB → OKLab (Björn Ottosson's matrices).
2. Interpolate per-channel in OKLab space.
3. Convert back: OKLab → linear sRGB → sRGB.

`glyph-palette-morph.js` exports the full conversion set.

## API

```js
const palettes = [
  GlyphGrid.paletteMorph.parse(['#000', '#ff00aa', '#7FFFD4']),
  GlyphGrid.paletteMorph.parse(['#001100', '#33FF66', '#88FFAA']),
];

// Blend at phase t ∈ [0, 1].
const cur = GlyphGrid.paletteMorph.cyclicBlend(palettes, t);
for (let i = 0; i < cur.length; i++) {
  fill(GlyphGrid.paletteMorph.toHex(cur[i].srgb));
  // ...
}
```

`cyclicBlend(palettes, phase)` wraps phase into [0, 1] and smoothly interpolates adjacent palettes on the loop. Seamless at phase 0 = phase 1.

## Rank padding (EC-8)

Palettes of different ink counts are rank-padded: shorter palette gets its last ink repeated to match the longer. Ink i in A always pairs with ink i in B.

## Determinism

Pure function of phase. No state. Use `t / duration` as phase for a single-loop animation; use `n * t / duration` for n cycles per loop.

## Configuration

```js
CONFIG.paletteMorph = {
  enabled: true,
  palettes: ['lovespark', 'phosphor', 'mono-amber'],   // keys into PALETTES
  cyclesPerLoop: 1,
};
```

`glyph-compat.gatePaletteMorph()` returns true only when `enabled: true`. When false, the current palette is used unchanged.

## Limitations

- OKLab conversion is ~5× slower than linear-sRGB lerp. At 3 inks × 1 frame it's negligible (<1 ms). At 60 inks × 30 fps it's ~10 ms. Cache aggressively: precompute parsed entries in `setup()`, interpolate only the current frame.
- Out-of-gamut results (OKLab has points that don't map to displayable sRGB) are clamped. Rare in practice with well-chosen palettes; you'll see it if you push saturated magentas through a green palette.
- Does not work with color palettes that include opacity — `rgba(...)` entries ignore the alpha channel during interpolation.

## References

- Björn Ottosson — "A perceptual color space for image processing" (2020). OKLab definition + matrices.
