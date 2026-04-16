# performance-budget.md — frame-time targets and CPU↔GPU crossover

## Target

30 fps recording → 33.3 ms per frame budget. Live preview should stay well under; 16.67 ms (60 fps) is ideal so the browser's compositor has slack.

## Tier 0 (baseline v1 path)

Current render.html with `compat: "v1"` on a 100×100 grid at 800×800:

| Stage | Cost (M2 MacBook) |
|---|---|
| Scene draw | 1–4 ms (scene-dependent) |
| `src.loadPixels()` | 0.3 ms |
| `drawGlyphGrid` (sampling + text draw) | 4–6 ms |
| Record frame (toDataURL + JSZip) | 3–8 ms per frame (record mode only) |

Total live: ~6 ms. Budget: 27 ms headroom.

## Tier 1 (shape-vector + dither + fonts)

Adds per frame on top of Tier 0:

| Stage | Cost |
|---|---|
| Linearize + Rec.709 luminance | 2 ms |
| XDoG prefilter (σ ≈ 1.2) | 5–10 ms |
| Dither (bayer) | 0.5 ms |
| Dither (error-diffusion) | 2–4 ms |
| Shape-vector selection | 15–25 ms @ 100×100, 60–80 ms @ 200×200 |

Tier 1 live at 100×100: ~20–35 ms. Over budget at the upper end. Action: drop grid to 80×80 OR enable GPU renderer.

## Tier 2 (CRT post-chain)

| Stage | Cost @ 800² |
|---|---|
| Phosphor decay | 1 ms |
| Halation | 7 ms |
| Bloom | 8 ms |
| Scanlines | 2 ms |
| Chromatic aberration | 2 ms |
| Barrel distortion | 4 ms |
| Vignette | 2 ms |

Full chain at 800²: ~25 ms. At 1080² scale linearly: ~45 ms. Action: enable only the stages you need; skip halation OR bloom (not both) for tightest budget.

## GPU crossover

| Grid | CPU live | GPU live | Winner |
|---|---|---|---|
| 50×50 | 3 ms | 4 ms (upload dominates) | CPU |
| 100×100 | 6 ms | 5 ms | tie |
| 150×150 | 14 ms | 6 ms | GPU |
| 200×200 | 28 ms | 8 ms | GPU |
| 300×300 | 90 ms | 12 ms | GPU |

GPU only helps once the glyph compositing is the bottleneck. At small grids, upload+readback dominates.

## Where seconds live

Top time sinks across tiers:

1. **XDoG prefilter** — dominated by the two Gaussian blurs. Separable, but still O(N × radius). Cut radius by reducing σ or use Tier 2 stages that don't need XDoG.
2. **Shape-vector selection** — tight V8 loop, but grows linearly with grid size and atlas size. Use smaller atlas (e.g., `asciiDense` 35 glyphs vs `octant` 230) when shape fidelity isn't the goal.
3. **CRT post chain** — multiple full-canvas passes. Disable bloom or halation; the other covers similar aesthetic.
4. **Record mode** — `toDataURL` + JSZip is synchronous per frame. v2 streaming recorder cuts this to ~1 ms per frame (filesystem) or ~2 ms (fflate worker).

## Measuring

Live status overlay (`#status`) prints sample ms per frame. Add your own timers in `draw()` to break down tier costs:

```js
const t0 = performance.now();
linearizeToLuminance(...);
const t1 = performance.now();
console.log('linearize:', (t1 - t0).toFixed(2));
```

For reproducible profiling: record, then run the saved frames through a separate script that measures the math cost in isolation. The harness's `capture.mjs` times each pipeline stage if `DEBUG_TIMING=1` env var is set (future enhancement; not yet implemented).

## Responsiveness targets

- Live preview: ≤ 16.67 ms per frame (60 fps).
- Recording: ≤ 33.3 ms per frame (30 fps); with streaming recorder, closer to ≤ 18 ms is achievable at 100×100.
- Fail-fast: live preview at 1080² + full post chain on a M1 Air drops to 15 fps. Either reduce grid or enable GPU.
