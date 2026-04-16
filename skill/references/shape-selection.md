# shape-selection.md — 6D shape-vector glyph selection (Harri 2024, unified)

## Method

For each source cell we compute a 6D "shape vector" — quadrant ink densities plus horizontal/vertical symmetry — and pick the glyph whose pre-computed vector is closest in Euclidean distance. The offline raster (`build-glyph-sets.py`) produces the glyph atlas; the runtime `glyph-shape-index.js` matches.

This is Alex Harri's 2024 "ASCII characters are not pixels" technique, adapted.

## Why 6D?

- The 4 quadrant values distinguish a forward slash from a backslash (which have the same ink fraction but opposite quadrants).
- The 2 symmetry values push visually pleasing choices: cells that are nearly-symmetric prefer symmetric glyphs; asymmetric cells prefer directional ones.
- More dimensions (8D octant, 12D regional) yield diminishing returns at n≈256 glyphs. Harri's paper validates 6D.

## External samples (IM edge-aware)

Within a cell, ink distribution is ambiguous at edges — a vertical line 1 px to the right of the cell boundary looks identical to one 1 px to the left. External samples (reach into adjacent pixel rows/cols by up to 1/4 cell) resolve this:

- `selectionMode: "shape"` — reach = cellSize / 4. Balanced.
- `selectionMode: "shape-edge-aware"` — reach = cellSize / 2. More aggressive edge incorporation; better on line-heavy scenes.

Outer-band samples are weighted 0.5 vs interior 1.0, so the in-cell shape still dominates. Defined in `glyph-shape-index.cellVector(opts.reach, opts.reachWeight)`.

## Per CR-10: T1.1 absorbs T1.2

In the original upgrade plan, shape-vector (T1.1) and edge-directional (T1.2) were factored as orthogonal subsystems. They are not. Harri's method **includes** edge-awareness through external samples — they are one pipeline.

Resolution:

- **T1.1 (shape-vector, unified)** → `glyph-shape-index.js`. Both selection modes (`shape`, `shape-edge-aware`) live here.
- **T1.2 (edge-directional only)** → `glyph-edge.js`. A cheaper alternative: plain Sobel on cellSignal, dispatch to a small 8-glyph directional alphabet. Use when you don't need shape matching, e.g. GPU-only pipelines or XDoG-heavy aesthetics.

## Algorithm

```
for each cell (r, c):
    vec = cellVector(luminance, cellX, cellY, cellW, cellH, { reach, reachWeight })
    bestIdx = 0; bestD = +∞
    for i in 0..atlas.size:
        d = Σ (atlas.vec[i][j] - vec[j])² for j in 0..5
        if d < bestD: bestIdx = i; bestD = d
    draw(atlas.glyphs[bestIdx].s)
```

O(N × atlas_size) per frame. For N = 100×100 = 10,000 cells and atlas_size = 256, that's 2.56M iterations per frame, each doing 6 subtractions and 6 multiplications. V8 inlines this to ~20 ms on an M2 — well inside the 16.67 ms frame budget with room for other work. If grids grow to 200×200 the per-frame cost doubles; at that point consider the GPU path (`renderer: "gpu"`).

## k-d tree deferred (per CR-3)

Theoretical speedup in 6D at n=256 is marginal. Tight Float32Array brute force is equal-or-faster in V8 because of cache locality and no pointer chasing. If a real piece exceeds frame budget, add a k-d tree behind a feature flag and regression-test against the brute-force output at same seed.

## Limitations

- **Works best on line-heavy or shape-heavy source**. Flat color fields produce flat shape vectors; the atlas picks similar glyphs everywhere, giving a boring output. Use `selectionMode: "brightness"` for flat-field scenes, or enable dither as a source-prefilter to break up flats (CR-6 note).
- **Near-binary source degrades the atlas hit rate**. XDoG output is 0 or 1 almost everywhere; shape-vector picks from a tiny subset (CR-7). Use `shape-edge-aware` with XDoG so directional glyphs preserve line quality at edges.
- **Palette color is per-cell, not per-glyph.** Shape selection doesn't know about color; it works on luminance. That's fine for the two-layer composite (we sample color separately and apply at draw).

## Testing

Atlas sanity: `ink` column in the JSON should be monotonically non-decreasing after density sort. Visual spot-check: render a gradient scene and verify the glyphs sweep from light to dense.

Determinism: same source frame + same atlas = same output indices. Covered by the regression harness.
