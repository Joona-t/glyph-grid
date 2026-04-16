# dithering.md — brightness-mode dither + source-prefilter variant

## When dither applies

Dithering quantizes a 1D brightness signal to a ramp index. It is meaningful only under `selectionMode: "brightness"` (CR-6). Under `shape`, `shape-edge-aware`, or `edge-directional`, dither is either ignored or applied as a source-prefilter (see below).

- `selectionMode: "brightness"` → dither operates on the per-cell brightness signal → quantized index maps to glyph in the ramp.
- Any shape mode → validator warns; dither is ignored unless `CONFIG.dither.asSourcePrefilter: true`, in which case it applies to the pre-selection luminance buffer (lumBuf) and the shape vectors are computed from the dithered source.

## Modes

| Mode | GPU? | Cost | Look | When to use |
|---|---|---|---|---|
| `none` | ✓ | 0 | flat | when you want clean quantization |
| `bayer4` | ✓ | O(N) | regular 4×4 crosshatch | retro, visible pattern |
| `bayer8` | ✓ | O(N) | regular 8×8 crosshatch | classic dither, less pattern |
| `blueNoise` | ✓ | O(N) | organic, low-frequency-dominant-free | modern default |
| `temporal` | ✓ | O(N) | shimmery, per-frame Bayer offset | animated scenes, loop closure OK |
| `floydSteinberg` | CPU | O(N) serial | smooth edges, diffuses error | photo-like source |
| `atkinson` | CPU | O(N) serial | sharp, 1/8 diffusion | 1-bit Mac aesthetic |
| `jarvisJudiceNinke` | CPU | O(N) serial | smoother than FS | when FS looks too wormy |

## Per CR-4: GPU restriction

Error diffusion (Floyd-Steinberg, Atkinson, JJN) carries per-pixel error forward serially. Fragment shaders execute in parallel with no inter-fragment communication, so WebGL can't run these. `glyph-compat.validate()` detects `renderer: "gpu"` + error-diffusion and auto-downgrades to bayer8 with a console warning. To keep error-diffusion, set `renderer: "cpu"`.

## Determinism (IM-9)

Temporal dither and blue-noise jitter both use `hash32(CONFIG.seed, frameIdx, x, y)` from `glyph-dither.js`. Not `Math.random()`, not `Date.now()`. Identical `(seed, frameIdx)` → identical output.

## Blue noise

Traditional blue noise is expensive to compute offline (void-and-cluster). The lib synthesizes a 128×128 hash-based approximation at load time; it's not pure blue noise but has high-frequency dominance that looks indistinguishable at glyph scale. To use a precomputed VoidAndCluster tile, replace `BLUE_NOISE` in `glyph-dither.js` with the loaded Float32Array — the rest of the pipeline is tile-agnostic.

The 128² tile is large enough that tiling periodicity is invisible at 1080² canvas. Smaller tiles (64²) show periodicity at cell sizes < 6 px. See EC-9.

## Source-prefilter mode

For shape-based selection modes, applying dither to the source **before** shape-vector encoding lets you get the anti-banding benefit of dither while still using shape matching. Pipeline:

1. Downsample luminance to cellSignal.
2. Dither cellSignal to a quantized level count (say 16).
3. UP-sample the quantized signal back to a luminance buffer.
4. Compute shape vectors from the up-sampled buffer.
5. Match to atlas.

This is controlled by `CONFIG.dither.asSourcePrefilter: true`. When set, the dither runs in the pipeline BEFORE shape-vector computation rather than being a selection-time quantization.

## Levels

`CONFIG.dither.levels` defaults to the active ramp length or atlas size. Override when you want coarser quantization (e.g., 4 levels for a 1980s-style poster dither) or finer (64 levels, for subtle anti-banding):

```js
CONFIG.dither = { mode: "bayer8", levels: 4 };
```

## Pairing

- `retroMode: "amiga-500"` includes `dither: { mode: "bayer4" }` by default.
- `retroMode: "terminal-80s"` ships `dither: { mode: "none" }` — the phosphor decay does its own anti-banding.
- `colorMode: "duotone"` + `dither: { mode: "blueNoise" }` produces the best gradient look.
