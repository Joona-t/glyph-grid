# pipeline.md — canonical stage order and determinism rules

The v2 glyph-grid pipeline is a linear chain of pure functions. Each stage has a CONFIG gate; when the gate is closed, the stage is skipped and consumes no random state, no palette state, and no time state. That property is what makes `compat: "v1"` byte-identical: no disabled stage can perturb a downstream stage via hidden side effects.

## Stage order (v2, CPU path)

```
scene(t)                              ← user scene function
  └─> src buffer (p5.Graphics, full-res)
      └─> [optional: XDoG prefilter]                  lib/glyph-xdog.js
          └─> linearize + Rec.709 luminance           lib/render.html (in-file)
              └─> downsample to cellSignal[rows×cols]
                  └─> [optional: Sobel on cellSignal]  lib/glyph-edge.js
                      └─> [optional: dither]           lib/glyph-dither.js
                          └─> [optional: zone lookup]  lib/glyph-zones.js
                              └─> glyph selection
                                    • brightness       (ramp index)
                                    • shape            lib/glyph-shape-index.js
                                    • shape-edge-aware lib/glyph-shape-index.js (external samples on)
                                    • edge-directional lib/glyph-edge.js
                                  └─> ink color (palette + [palette morph])  lib/glyph-palette-morph.js
                                      └─> glyph draw (text() or atlas blit)
                                          └─> canvas
                                              └─> [optional: CRT post chain]  lib/glyph-crt.js
                                                  └─> [optional: streaming record]  lib/glyph-record.js
```

## Seed-consumption rules

- Every stateful stage takes an explicit `seed` + `frameIdx`.
- The skill-wide seed (`CONFIG.seed`) is drawn from once per frame to seed p5's `randomSeed()` + `noiseSeed()` on both the visible canvas and the src buffer (baseline v1 behavior).
- Stages that advance a per-frame state (phosphor decay, palette morph) must produce identical state trajectories for identical `(seed, frameIdx)` sequences — no `Math.random()`, no `Date.now()`.
- Temporal dither: `applyTemporal` in `glyph-dither.js` uses `hash32(seed, frameIdx, ...)` as its offset. Reproducible.
- Blue noise: tile origin is jittered with the same hash. Reproducible.
- **When a stage is disabled**, it must not consume any RNG/hash/timer call. `glyph-compat.gate*` short-circuits before the stage runs; this is the only way v1 byte-identity holds.

## Test contract

For every frozen piece:

1. Frame-0 byte-identical test (same browser + OS + seed).
2. Full-loop ΔE94 max < 1 (JND threshold).
3. RNG-state test: record p5 RNG state before and after the pipeline; state must equal pre-pipeline state under `compat: "v1"`.

Harness: `harness/run.mjs`. See `harness/README.md`.

## GPU path

When `CONFIG.renderer: "gpu"` AND `glyph-gpu.isSupported()`:

- Steps 1–4 run on CPU (linearize, cellSignal, optional dither).
- Step 5 (selection) runs on CPU: error-diffusion is serial (CR-4), shape-vector is at n=~256 where V8 is faster than the GPU round-trip for upload+dispatch.
- Step 6+ run on GPU: cp grid + color grid are uploaded as textures, a single shader samples the glyph atlas and writes the final pixels.
- CRT chain stays on CPU in v2 (simpler; a future v3 could move box-blur passes to GPU).

GPU parity test: CPU frame 0 vs GPU frame 0 at same seed, ΔE94 max < 2.

## Why this ordering

- **XDoG before linearization**: XDoG is defined on gamma-encoded luminance in the original paper. We apply it first on the sRGB channels (via lumBuf before linearization overwrites it), then downsample.
- **Linearize before downsample**: averaging in gamma-encoded space darkens midtones (Rec.601 luminance averaging is the wrong primitive). Rec.709 weights on linear sRGB is the correct physical luminance.
- **Sobel on cell grid, not full grid (IM-3)**: full-res Sobel picks up sub-cell aliasing that no glyph can represent. Cell-res Sobel captures exactly the gradient between adjacent glyph cells, which is what the directional glyph chooses.
- **Dither before selection in brightness mode**: dither is a 1D→1D operation on the ramp index. It cannot apply under shape-vector selection (CR-6). Validator warns if the user tries.
- **Post-process after draw**: CRT, bloom, scanlines operate on the final pixel grid. Phosphor decay requires the last frame's pixels, which only exist post-draw.
- **Record at the end**: streaming recorder only sees final composed pixels.
