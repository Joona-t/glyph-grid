# crt-postprocess.md — CRT + bloom + aesthetic post-process chain

## Stages

Run in this fixed order AFTER glyph draw, BEFORE record:

```
1. phosphor decay     ← stateful (previous frame)
2. halation           ← bright threshold → blur → add
3. bloom              ← broader halation
4. scanlines          ← multiplicative darken of alternating rows
5. chromatic aberration ← R/B x-shift, CR-9 clamped
6. barrel distortion  ← radial warp
7. vignette           ← radial darken at edges
```

Each has its own `enabled` flag. `glyph-compat.gatePostprocess()` returns true iff at least one flag is on. Disabling all = no post chain; the gate returns false and the canvas is final.

## Per CR-8: phosphor decay loop closure

Exponential fade from the previous frame means frame 0 has no decayed content from frame N-1. A recorded loop snaps visibly at the seam.

Fix: pre-roll N warm-up frames before recording. Empirically, N ≈ `duration × fps × 0.25` frames is enough for `decayFactor ≤ 0.92` to reach steady state. `glyph-crt.prerollFrames(n, capture, state, postOpts, runtime)` drives this.

Render path:

1. Before recording starts, drive the scene forward by N frames, applying the full pipeline including CRT.
2. Discard the rendered canvas output of those frames.
3. Reset `frameIdx = 0` and begin recording.

The phosphor state is preserved across the reset, so the first recorded frame already carries decayed signal and closes cleanly.

## Per CR-9: chromatic aberration clamping

Real CRTs had convergence error, not per-pixel chromatic aberration. Modern "CRT" filters add aberration for aesthetic feel, but at small glyph cells (< 8 px) even a 1 px per-channel offset renders glyphs unreadable.

Rules enforced by the lib:

- Absolute offset clamped to `[-5, 5]` pixels.
- Caller computes `offset = min(opts.offset, 0.5 * cellSize)` before passing.
- Recommended stays subtle (0.25–0.75 px).
- When `cellSize < 8`, set `postprocess.chromaticAberration.enabled = false`.

## Phosphor decay math

```
phosphor_linear[i] = max(new_linear[i], previous_phosphor_linear[i] * decayFactor)
```

Max-blend (not linear blend) preserves bright trails without darkening live content. Linear-light space required — gamma-encoded max-blend produces wrong values at bright-on-dark boundaries.

Default `decayFactor = 0.85`. Terminal-80s retro preset uses 0.92 (slow decay = long phosphor trails). Values above 0.95 cause visible ghosting at 30 fps; cap around 0.96.

## Scanlines

Multiplicative darken of every `period`-th row. `period = 2` darkens every other row (classic CRT look). Intensity 0.2 is subtle; 0.4 is strongly visible. Above 0.5 the content becomes hard to read.

Under `prefers-reduced-motion`, the scanline `phase` is forced to 0 (static), not animated between frames.

## Bloom vs halation

Both use box blur of a bright-threshold extraction, added back with intensity. Differ in defaults:

- **halation**: low threshold (0.3), medium intensity (0.3), small radius (4). Mimics CRT phosphor glow — light areas bleed slightly.
- **bloom**: higher threshold (0.75), stronger intensity (0.5), larger radius (6). General "warm glow" effect.

Run both for saturated CRT look; run bloom only for modern scene aesthetic.

## Barrel distortion

Light radial warp via per-pixel resample. Strength 0.08 = slight bulge (classic CRT). Strength 0.2 = strong fishbowl. Strength > 0.3 = kitsch.

Nearest-neighbor resample — bilinear would soften glyph edges. Glyph blocks with sharp boundaries are what we want.

## Vignette

Radial darken at canvas corners. Quadratic falloff (`1 - strength * r²`) so the darkening is gentle near center, strong at corners. Strength 0.5 is the CRT default; 0.25 is subtle.

## Reduced motion

`runtime.prefersReducedMotion: true` (or `window.matchMedia('(prefers-reduced-motion: reduce)').matches`) disables animated components:

- Scanline phase stays 0 (no sub-pixel shimmer).
- Phosphor decay disabled (no trails following fast-moving content).
- Chromatic aberration still applies but with static offset.

The rendered output is still visually CRT-ish but without motion-sensitive artifacts.

## Performance

Post chain on CPU at 1080×1080:
- phosphor decay: ~1 ms
- halation + bloom (each): ~8 ms
- scanlines, chromatic, vignette, barrel: ~2 ms each

Full chain: ~25 ms. With shape-vector selection (~20 ms) this pushes past the 16.67 ms frame budget — either drop to smaller canvas (720²: ~10 ms chain), drop a stage, or move to GPU renderer (post chain still runs on CPU in v2; a future v3 port would take 5–8 ms total).
