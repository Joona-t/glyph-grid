# xdog.md — XDoG (Extended Difference of Gaussians) prefilter

## Purpose

Convert the source buffer into stylized line art before glyph encoding. Produces graphic-novel/ink-drawing feel without the per-cell edge Sobel (which lives in `glyph-edge.js`).

## Formula (Winnemöller 2012)

```
G(σ, I)     = separable Gaussian blur of I with σ
DoG         = G(σ) − τ · G(k·σ)
XDoG(I)     = 1                         if DoG ≥ ε
            = 1 + tanh(φ · (DoG − ε))    otherwise
```

Default parameters (per the Winnemöller paper):

- σ = 1.0 (base blur)
- k = 1.6 (σ ratio, Marr-Hildreth standard)
- τ = 0.98 (scale of second blur's subtraction)
- φ = 40 (tanh steepness; higher = more binary)
- ε = 0.003 (soft threshold)
- invert = true (default: dark edges on light, matches ink-on-paper)

## Per CR-5: dynamic kernel radius

The original plan specified a fixed 4-tap Gaussian. That's correct only for σ ≤ 0.67. For σ ≥ 1 a 4-tap kernel truncates the Gaussian, producing misaligned subtraction in the DoG pair and visible ringing.

`glyph-xdog.js` computes `radius = ceil(3 · σ)` per σ (captures ~99% of the Gaussian mass). The kernel1D weights are cached per σ — a piece typically uses 2–4 distinct σ values (σ and k·σ), so cache churn is negligible.

Supported range: σ ∈ [0.5, 5.0]. σ = 0.5 → 5-tap; σ = 5.0 → 31-tap. The filter clamps outside this range and logs a warning.

## Gaussian boundary handling

Reflect (`abs(i)` below 0, `2W-i-2` above W-1). Produces no edge artifacts at the image boundary. Clamp-to-edge produces a dark border; zero-pad produces a light border — both bad for a stylization prefilter.

## Combining with selection modes

- **XDoG + brightness (default ramp)** → standard ASCII line art. Works well.
- **XDoG + shape** → degenerates (CR-7). XDoG output is near-binary; 6D shape vectors collapse to a handful of bins; atlas match picks the same few glyphs everywhere. Validator warns.
- **XDoG + shape-edge-aware** → correct combination. External samples pick up directional structure; interior cells still benefit from shape matching on the near-flat regions XDoG preserves.
- **XDoG + edge-directional** → also good. Lines get directional glyphs; flats get the fallback glyph.

## Pipeline position (IM-2)

XDoG runs on the **luminance buffer** (lumBuf, linear-light Rec.709). Pipeline:

```
src → linearize → lumBuf → [XDoG] → downsample to cellSignal → ...
```

So XDoG operates at source resolution, BEFORE the cell-grid downsample. That's where it makes sense — at cell resolution the DoG kernel has no room to work.

Caveat: at very small σ (< 0.5) the kernel collapses to a 3-tap and the DoG produces near-zero output everywhere. Set σ ≥ 0.7 for visible effect.

## Configuration

```js
CONFIG.prefilter = {
  mode: "xdog",
  sigma: 1.2,
  k: 1.6,
  tau: 0.98,
  phi: 40,
  epsilon: 0.003,
  invert: true,
};
```

## References

- Winnemöller, Kyprianidis, Olsen 2012 — "XDoG: An eXtended difference-of-Gaussians compendium including advanced image stylization".
- Marr & Hildreth 1980 — "Theory of edge detection" (origin of k = 1.6).
- HIPR2 Spatial Filters — Gaussian Smoothing (kernel radius = 3σ rule).
