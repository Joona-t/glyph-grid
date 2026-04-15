# The glyph-grid technique

A one-paragraph description of what's happening, then the bits that matter.

## The technique

**Two-layer composite, not a single-pass ASCII converter.** Most "text ASCII art" converters take an image and map pixels to characters in one go. glyph-grid instead draws a real p5.js scene into an offscreen `p5.Graphics` buffer at full resolution — real `line()`, `vertex()`, `ellipse()`, `image()` calls, real antialiasing, real Perlin noise — and then a *second* pass walks an `N×M` grid over that buffer, samples each cell, picks a character from a density ramp, and draws the glyph on the visible canvas with the source color preserved. The result is cleaner than any one-pass conversion because the source layer is real geometry, not a pre-rasterized image, and the glyph layer gets to shade with *actual* brightness data rather than pre-quantized pixels.

Animation is just re-rendering the source per frame and re-sampling the grid. Export is capturing frames to PNGs and stitching them with ffmpeg.

## The scene contract — LOCKED

Every scene implements:

```
scene(g: p5.Graphics, t: number, config: CONFIG) => void
```

- **`g`** — the offscreen source buffer. The scene draws into it. It mutates in place. `g` has its own random/noise state, seeded in `setup()`, so scenes must call `g.noise(...)` and `g.random(...)`, **not** the globals. This is critical for recording determinism.
- **`t`** — seconds since loop start, wrapping at `config.animation.duration`. Scenes parameterize on `t` directly — no per-frame state, no module-level counters. If you need an "initial condition" for frame 0, compute it from `t=0`. This is the rule that makes record mode deterministic and loops seamless.
- **`config`** — the full `CONFIG` object. Scenes read palette data via `inkColor(config, i)` and `bgColor(config)` so the same scene works on every palette without modification.

Return value is ignored. After the scene returns, the glyph-grid pass calls `g.loadPixels()` and reads `g.pixels`.

**Do not change this signature.** If you need additional inputs, add them to `config`, not the signature. The skill's scene-switching and palette-swapping both depend on scenes being interchangeable.

## Why `signal-from-bg`, not raw brightness

The sampling pass computes per cell:

```
signal = sqrt((r - bgR)² + (g - bgG)² + (b - bgB)²) / MAX_RGB_DIST
```

Not `signal = (r + g + b) / 3 / 255`. The RGB distance from the palette background is the right primitive because:

- On a **black** background, it degenerates to luminance — bright pixels score high, same as naive brightness.
- On a **cream** background (`bauhaus` palette), dark strokes correctly score HIGH because they're *far* from cream. Naive brightness would make them score LOW and their glyphs would disappear.
- On a **tinted** background (phosphor's dark green, mono-amber's dark brown), bright strokes in the *same hue* still score high because they're far from the bg along the luminance axis.

The skip threshold (`signal < 0.02`) is also bg-aware: cells that are essentially the background get no glyph, so the page color shows through cleanly without needing transparent overlays.

## Why `preserve` color mode normalizes deltas

Naïve "preserve" would just use the raw sampled `(r, g, b)`. That breaks on:

- **Dim lines** — average-sampling a thin magenta line on black gives something like `(60, 10, 30)`, which glyph-draws as dark brown. Ugly.
- **Light backgrounds** — dark red on cream, raw-sampled, reads as muted beige because the sampled color is a mix of "dark red" and "cream" pixels.
- **Tinted backgrounds** — green-on-green on phosphor palette desaturates toward gray.

The normalized version computes `delta = sample - bg`, scales by `255 / max(|delta|)`, and re-adds bg. The result: the line's hue is preserved regardless of brightness, bg tint, or bg darkness. It's a saturation boost that's also direction-aware.

Trade-off: because the normalization is per-cell, nearby cells with *different* brightness can end up at the same normalized color. That's the correct behavior for "give me the hue, quantize the brightness into glyph density."

## Why `brightnessGamma` defaults to 0.5

Most scenes are **thin** geometry on a dark bg — lines, curves, particles. `average` sampling of a thin line inside an 8×8 cell gives low occupancy: maybe 0.2 of the cell is actual line. That maps to `signal ≈ 0.2`, which with a linear ramp lands on `'.', '·'` — the low end. The whole scene renders as sparse dots.

`pow(signal, 0.5)` = `sqrt(signal)` boosts mid-tones so `0.2 → 0.45`, landing on `'=', '+'` — the meaningful middle of the ramp. The scene reads correctly.

For **solid-fill** scenes (big shapes, not lines), use `brightnessGamma: 1.0` (linear). For **very thin** scenes (single-pixel strokes, sparse particles), use `0.3` for an aggressive boost. The default of `0.5` works for 90% of cases.

## Sampling strategies — the trade-offs

Three strategies, picked via `CONFIG.samplingStrategy`:

- **`average`** (default) — mean over all pixels in the cell. Smoothest. Best for anti-aliased line art. Most expensive per cell, but the 100×100 grid on 800×800 canvas samples in ~10–20ms on modern hardware, well under budget.
- **`nearest`** — just read the cell-center pixel. Fastest. Aliases badly on thin geometry — a line between two cell centers disappears. Use for high-density grids (140×140+) where each cell is small enough that aliasing stops mattering, or for chunky shapes where anti-aliasing is irrelevant.
- **`edge-weighted`** — 3×3 Sobel on cell corners + midpoints, color from the cell center. Blends edge magnitude into the signal (40% brightness, 60% edge). Boosts glyph density along edges, giving a "wireframe" look. Best for scenes with strong contours you want to emphasize — `caduceusHelix` helices, `concentricRings`. Awkward on `flowField` because field lines have no "inside" to contrast against.

## Why the default grid is 100×100

On an 800×800 canvas that's 8×8 pixel cells. At a 10-point monospace font, glyphs fit cleanly inside the cell with ~1px margin on each side — no character collisions, no overflow. The sampling pass touches 10,000 cells per frame, which is cheap (~10-20ms with `average`).

Bumping to 120×120 or 140×140 gets you denser, more photographic output at the cost of sample time and readability (characters start visibly touching). Dropping to 70×70 gives you chunky retro text-mode look — good for sparse ramps like `unicode-block`.

**If you bump cols/rows, bump font size proportionally.** Rule of thumb: `font.size ≈ cellW - 2`. The default 100 cols / 800 canvas = 8px cells, so font 10 overflows slightly (intentional — dense ramp glyphs like `@` fill the cell). If you go 140 cols / 800 canvas, that's ~5.7px cells, and font 10 will collide. Drop to font 7 or 8.

## Why p5 + JSZip from CDN, one file, no build

The whole renderer is ~700 lines of vanilla JS + one `<script>` tag for p5 + one for JSZip. No npm, no webpack, no tsconfig, no hot reload. `open index.html` and you're running.

Rationales:

1. **Portability** — a single HTML file survives being emailed, gisted, or dropped into any directory. No install instructions.
2. **Carmack principle** — no hidden control flow, no framework magic. The draw loop is 50 lines and you can read it top to bottom.
3. **Recording-friendly** — p5's `drawingContext.canvas.toDataURL('image/png')` is built into the browser. JSZip packs frames into one blob. Download triggers via a synthetic `<a>` click. Zero server, zero backend, zero auth.
4. **Skill-friendly** — when an agent scaffolds a new piece from this template, the entire "dependency install" is `cp render.html .` + `open it`. No environment setup, no "please run `npm install`."

If you find yourself wanting to add a bundler, a framework, or a TypeScript build — stop. The single-file constraint is load-bearing.
