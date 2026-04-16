# migration-compat.md — v1 ↔ v2 compatibility

## TL;DR

Old pieces keep working. Add `CONFIG.compat = "v1"` if you want a safety belt; otherwise leave it at the v2 default — all new stage gates are inert unless you explicitly turn them on.

## The single switch

`CONFIG.compat` has three behaviors:

| Value | Behavior |
|---|---|
| `"v1"` | Every v2 gate returns false. Pipeline takes the legacy `drawGlyphGrid` path, byte-identical to the pre-upgrade render.html. |
| `"v2"` | Gates consult their own fields. With no advanced fields set, still takes the legacy path. |
| (omitted) | Defaults to `"v2"`. |

The file `scripts/lib/glyph-compat.js` owns this policy. No other lib decides what "v1" means; they all consult `GlyphGrid.compat.gate*(CONFIG)`.

## What's guaranteed

**For every frozen portfolio piece (8 pieces):**

1. Re-rendering the piece's exact old `CONFIG` in the new template under `compat: "v1"` produces byte-identical pixels at frame 0.
2. ΔE94 max across the full loop < 1 (below just-noticeable-difference).
3. Cross-browser / cross-OS parity at frame 0, **after** the bundled Cascadia WOFF2 subset has loaded.

**For pieces that opt into v2 advances:**

4. CPU vs GPU parity for frame 0 at same seed: ΔE94 max < 2 (perceptually indistinguishable).
5. Loop closure for stateful stages (phosphor decay, palette morph, temporal dither): frame 0 vs frame N-1 ΔE94 max < 2.

## How to opt into v2 features

Add fields to `CONFIG`. Any unset v2 field leaves its gate off.

```js
CONFIG.compat = "v2";                 // default, optional
CONFIG.glyphSet = "octant";           // enables atlas load + 6D shape index
CONFIG.selectionMode = "shape";       // brightness | shape | shape-edge-aware | edge-directional
CONFIG.dither = { mode: "bayer8", levels: 16 };
CONFIG.prefilter = { mode: "xdog", sigma: 1.2, tau: 0.98, phi: 40, epsilon: 0.003 };
CONFIG.postprocess = {
  scanlines:   { enabled: true, intensity: 0.2, period: 2 },
  bloom:       { enabled: true, threshold: 0.75, intensity: 0.4, radius: 5 },
  phosphorDecay: { enabled: true, decayFactor: 0.9 },
};
CONFIG.retroMode = "terminal-80s";    // preset (applied BEFORE user fields)
CONFIG.renderer = "gpu";              // "cpu" (default) | "gpu"
CONFIG.zones = { enabled: true };     // requires scene-contract v2
CONFIG.paletteMorph = { enabled: true, palettes: ["lovespark", "phosphor"] };
CONFIG.recording = { mode: "auto" };  // filesystem → fflate → legacy fallback chain
```

## Scene contract evolution

- **v1 scenes** `(g, t, config) => void` remain supported unchanged.
- **v2 scenes** may return `{ zones: p5.Graphics }`. If the return object has a `zones` buffer, zone-variable CONFIG kicks in. See `scene-contract-v2.md`.

## Validators and warnings

`glyph-compat.validate(CONFIG)` runs at setup and logs warnings for:

- CR-4 — GPU renderer + error-diffusion dither → auto-downgrade to bayer8.
- CR-6 — dither + shape-vector selection → dither ignored (source-prefilter variant is allowed).
- CR-7 — XDoG + shape selection → recommend shape-edge-aware.

## What migration does NOT do

- It does not change your CONFIG file on disk. Opting in is explicit.
- It does not re-raster frozen pieces. Their PNGs stay as-is.
- It does not change scene function signatures. v1 scenes still work.
- It does not change the `__glyphGridTest` hook contract beyond:
  - `getConfig()` now returns a deep clone (EC-4) — callers that mutated the live object must adjust.
  - `beginRecord` accepts an options object (`{ total, fps, onFinish }`) in addition to the legacy `(total, onFinish)` form.
  - Added `getSkillVersion()` returning `"2.0.0"`.

## Opting back to v1 mid-project

If a v2 stage is introducing unexpected artifacts, flip `CONFIG.compat = "v1"` to isolate. Every advanced gate returns false; the pipeline reverts to the legacy drawGlyphGrid. Pieces that had started to rely on, say, shape-vector selection will lose that — revert the config change once you've identified which v2 field caused the regression.
