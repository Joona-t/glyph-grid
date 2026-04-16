# gpu-renderer.md — WebGL2 path

## What's on GPU

- Glyph compositing: a single fragment shader samples per-cell `cpIdx` from a grid texture, looks up the glyph in the atlas texture, and outputs ink color sampled from the per-cell color grid.
- That's it. Everything else (linearization, cellSignal, selection, dither, post-process) stays on CPU in v2.

## What stays on CPU

- Error-diffusion dither (CR-4) — serial by definition, impossible in a fragment shader without a round-trip per scanline.
- Shape-vector selection — at n ≈ 256, k = 6, V8 brute force beats the GPU round-trip cost.
- CRT post-process chain — v2 keeps it on CPU for simplicity. A future v3 port of the box-blur passes would reduce post-chain cost from ~25 ms to ~5–8 ms.

## Upload contract

Every frame:

1. `uploadCpGrid(ctx, cpGrid, cols, rows, atlasSize)` — packs `cpIdx/atlasSize` into an R8 texture.
2. `uploadColorGrid(ctx, colorGrid, cols, rows)` — RGBA8 sRGB per cell.
3. `render(ctx, { cols, rows, cellW, cellH })` — draw.

Atlas upload is one-time at setup (or when `CONFIG.glyphSet` changes).

## Readback for post-process

`glyph-gpu.readPixels(ctx)` returns an ImageData reading the GPU framebuffer, then the CPU CRT chain operates on it. Readback adds ~2 ms at 1080² on an M2 — acceptable, and avoids duplicating the post chain in GLSL.

## Parity with CPU path

GPU output must match CPU output within ΔE94 < 2 at frame 0 with the same seed. Sources of drift:

- Texture filtering (nearest vs linear): all glyph-grid textures use NEAREST. Bilinear would soften glyph edges and the shader output would average across cells.
- Color conversion: both paths use sRGB for ink colors (no conversion in the shader).
- Atlas sampling: at glyph cell boundaries we use `fract(frag / cellSize)` to compute within-cell UV; CPU path draws via `text()` which the browser positions identically.

Regression: `harness/manifest.json` can run the same piece twice, once with `renderer: "cpu"` and once with `renderer: "gpu"`, diff the two. Use threshold 2.0.

## Fallback

`glyph-gpu.isSupported()` returns false when:
- `canvas.getContext('webgl2')` returns null (most likely older Safari, or blocked WebGL).
- Shader compile or link fails.

`glyph-compat.gateGPU()` defers to the lib: if GPU unsupported, the gate returns false even when `renderer: "gpu"` is set. The pipeline auto-downgrades to CPU and logs a console warning.

## When to use

- Grid densities > 150×150.
- Canvas resolutions ≥ 1440×1440.
- Live preview where you want headroom for complex scenes.
- NOT when: recording a portfolio piece that's been CPU-only until now (GPU parity is tight but not identical; safer to re-record after validating).

## Configuration

```js
CONFIG.compat = "v2";
CONFIG.renderer = "gpu";
CONFIG.selectionMode = "brightness";   // or "edge-directional"; shape selection still runs on CPU
CONFIG.dither = { mode: "bayer8" };    // GPU-compatible
```

Error-diffusion + GPU triggers CR-4 validator warning + auto-downgrade.

## Limitations

- Requires WebGL2. No WebGL1 fallback (lacks `R8` texture format and `texelFetch`).
- Premultiplied-alpha canvas quirks: we set `premultipliedAlpha: false` on context creation; if the host page changes CSS blend modes, output may need manual compensation.
- `preserveDrawingBuffer: true` is required for the readback-to-CPU post step. Costs ~10% FPS vs `false`, but readback needs the buffer intact after present.
