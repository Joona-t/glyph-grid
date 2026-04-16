# BUGS_AND_ITERATIONS — glyph-grid skill

Every bug fix and iteration lands here with date, problem, root cause, fix.

## 2026-04-16 — v2.0.0 upgrade infrastructure (Phase 0 + tier scaffolding)

### Context
Upgrade plan: `~/.claude/plans/iterative-coalescing-clover.md` (approved).
Critique / edge-case plan: `~/.claude/plans/snazzy-yawning-dragon.md`.
Eight frozen pieces must regenerate byte-identically under `CONFIG.compat: "v1"`.

### CR-1 — Rec.601 weights on linearized luminance was a category error
- **Problem:** plan specified "Sobel on linearized Rec.601 luminance."
- **Root cause:** Rec.601 weights are defined on gamma-encoded luma. Rec.709 is the luminance spec for linear-light sRGB.
- **Fix:** all luminance-on-linear-light code paths use Rec.709 weights (0.2126, 0.7152, 0.0722) after an sRGB EOTF (piecewise, not `pow 2.2`). Documented in `references/pipeline.md`.

### CR-2 — Unicode 16 octants lacked system-font coverage
- **Problem:** no mainstream OS ships octants by default.
- **Root cause:** octants are Unicode 16.0 (Sep 2024); font catch-up is ongoing.
- **Fix:** bundle a Cascadia Mono WOFF2 subset (~80 KB) with explicit `@font-face unicode-range` per set; runtime availability detection cascades octant → sextant → braille → block.

### CR-3 — k-d tree vs brute-force in JS at n≈256, k=6
- **Problem:** plan claimed 10× speedup from k-d tree.
- **Root cause:** at the n/k regime where the shape atlas sits, tight Float32Array brute-force loops are often equal or faster in V8 than a pointer-chasing k-d tree.
- **Fix:** implement brute-force (unrolled distance loop) first, profile, add k-d tree only if a real piece exceeds frame budget.

### CR-4 — Error-diffusion dither cannot run on WebGL
- **Problem:** plan assumed all dither modes work on GPU.
- **Root cause:** Floyd-Steinberg / Atkinson / Jarvis carry per-pixel error forward serially; fragment shaders have no inter-fragment communication.
- **Fix:** validator in `glyph-compat.js` warns and auto-downgrades to `bayer8` when `renderer: "gpu"` + error-diffusion mode.

### CR-5 — XDoG 4-tap Gaussian was under-sampled for σ > 0.67
- **Problem:** fixed 4-tap Gaussian causes DoG truncation artifacts.
- **Root cause:** correct Gaussian kernel radius is `ceil(3σ)`; 4-tap covers radius 2, insufficient for σ ≥ 1.
- **Fix:** dynamic kernel radius = `ceil(3σ)`, separable; weights cached per σ; supported σ range 0.5 (5-tap) to 5.0 (31-tap); clamp outside with console warning.

### CR-6 — Dither + shape-vector is a paradigm mismatch
- **Problem:** dither quantizes 1D brightness; shape-vector matches 6D vectors directly; no shared "ramp index."
- **Fix:** validator warns; dither applies under `selectionMode: "brightness"` OR as source-prefilter before shape encoding.

### CR-7 — XDoG then shape-vector collapses glyph diversity
- **Problem:** XDoG's near-binary output produces only a handful of shape-vector bin classes.
- **Fix:** validator recommends `selectionMode: "shape-edge-aware"` when prefilter is XDoG so directional glyphs preserve line quality at edges.

### CR-8 — Phosphor decay breaks loop closure at frame 0
- **Problem:** exponential decay from N-1 → 0 causes a visible snap on record.
- **Fix:** pre-roll N warm-up frames before recording (N ≈ duration × fps × 0.25).

### CR-9 — Chromatic aberration at glyph scale destroys legibility
- **Problem:** >0.5 px offset at 8 px cells produces unreadable glyphs.
- **Fix:** clamp per-channel offset to `≤ 0.5 × cellSize px`; disable by default when `cellSize < 8 px`.

### CR-10 — Harri's shape-vector method already bundles directional contrast
- **Problem:** plan factored shape-vector (T1.1) and edge-directional (T1.2) as orthogonal.
- **Fix:** T1.1 is the unified path (shape-vector + directional contrast with external samples). T1.2 is the cheap edge-only alternative for pipelines that skip shape.

### IM-1 — `SKILL_VERSION` + `CONFIG.compat` gate
- **Added:** `SKILL_VERSION = "2.0.0"`, `CONFIG.compat: "v1" | "v2"` (default "v2"); single switch disables every new stage under v1.
- **File:** `scripts/lib/glyph-compat.js`.

### IM-4 — Scene contract v2 (optional zone buffer)
- **v1 scenes:** `(g, t, config) => void` (unchanged).
- **v2 scenes:** `(g, t, config) => { zones?: p5.Graphics } | void`.
- Loader sniffs return value; if `{ zones }`, binds zone buffer for T2.3.

### IM-5 — Streaming recording promoted to Phase 0
- **Added:** `scripts/lib/glyph-record.js` — File System Access API writable + fflate Worker fallback.

### IM-9 — Temporal-dither seed reproducibility
- **Rule:** all temporal jitter (temporal dither offset, blue-noise tiling) uses `hash(CONFIG.seed, frameIdx)`. Never `Math.random()`. Never `Date.now()`.

### IM-10 — Headless regression harness
- **Added:** `harness/capture.mjs` (Playwright), `harness/diff.mjs` (pixelmatch + ΔE94), `harness/goldens/`.

### Verified determinism of current render.html (baseline for byte-identical regeneration)
- `pixelDensity(1)` on both canvas + `src` Graphics: lines 504, 506.
- RNGs seeded on both contexts: lines 510–513.
- No `Math.random()`, `Date.now()` for state (verified via grep).
- `t = frameIdx / fps` in record mode (line 547–548).
- The only cross-OS non-determinism is `textFont('monospace')` resolving to OS-default. Bundled Cascadia Mono (Q5) eliminates it.

## 2026-04-17 — v2.0.0 implementation complete (Phases 0–3)

### Phase 0 — Infrastructure
- **PH0-1** `scripts/lib/glyph-compat.js` — SKILL_VERSION = "2.0.0", `CONFIG.compat` gate, 11 stage gates (gateShapeSelection, gateEdgeDirectional, gateDither, gatePrefilter, gatePostprocess, gateZones, gatePaletteMorph, gateRetroMode, gateGPU, gateStreamingRecord), validators for CR-4/CR-6/CR-7.
- **PH0-2** `harness/` — Playwright capture (`capture.mjs`) + ΔE94 diff (`diff.mjs`) + driver (`run.mjs`) + manifest.json + README. Default threshold 1.0 for v1 frozen pieces, 2.0 for CPU↔GPU parity.
- **PH0-3** `fonts/` — README with pyftsubset commands, LICENSE (OFL 1.1 + CC0), `fetch-fonts.sh` one-shot builder. Three targets: cascadia-mono-subset.woff2, babelstone-pseudographica-subset.woff2, pxplus-ibm-vga8.woff.
- **PH0-4** `scripts/lib/glyph-fonts.js` — `@font-face` injection, `document.fonts.load()` race with timeout, availability detection via tofu-width + M-width comparison, cascade order `octant → sextant → braille → blockElements → asciiDense → ascii`.
- **PH0-5** `scripts/lib/glyph-record.js` — File System Access → fflate (streaming ZIP) → JSZip fallback chain. Capability probes for each.

### Phase 1 — Paradigm
- **P1-1** `scripts/build-glyph-sets.py` — font-based offline rasterizer (16×32 px cell) emitting `{ cp, s, ink, vec }` per glyph. 6D vec per CR-10 / shape-selection.md.
- **P1-1b** `scripts/build-glyph-sets-analytical.py` — font-free generator for procedural sets (braille, sextant, octant, blockElements, ascii, asciiDense). Skipped font dependency for shipping JSON out of the box.
- **P1-2** `glyph-sets/*.json` — generated via analytical builder.
- **P1-3** `scripts/lib/glyph-dither.js` — Bayer4/8, blue-noise (128² hash-synthesized), temporal (hash32 offset per frame), Floyd-Steinberg, Atkinson, Jarvis-Judice-Ninke. `isGPUCompatible(mode)` for CR-4 enforcement.
- **P1-4** `scripts/lib/glyph-shape-index.js` — `buildAtlas`, `cellVector` (external samples with `reach` + `reachWeight`), `select` (brute force 6D), `selectAll`, `selectGrid`. Per CR-10, absorbs both shape + edge-aware in one lib.
- **P1-5** `scripts/lib/glyph-edge.js` — cheap 3×3 Sobel on cell-res signal (IM-3) + 8-bin directional alphabet. Rec.709-required docstring (CR-1).

### Phase 2 — Aesthetic
- **P2-1** `scripts/lib/glyph-xdog.js` — XDoG with dynamic kernel radius = `ceil(3σ)` (CR-5), σ range 0.5–5.0. Weights cached per σ. Separable Gaussian with reflective boundaries.
- **P2-2** `scripts/lib/glyph-zones.js` — zone-buffer sampling (4-corner quadrant), zone-config merge, boundary blend helpers (EC-7).
- **P2-3** `scripts/lib/glyph-palette-morph.js` — OKLab interpolation (Ottosson 2020), rank-pad for mismatched lengths (EC-8), `cyclicBlend` for loop-safe animation.
- **P2-4** `scripts/lib/glyph-crt.js` — phosphor decay (max-blend in linear light), halation, bloom, scanlines, chromatic aberration (clamped, CR-9), barrel distortion, vignette. `prerollFrames` for CR-8 loop closure. Reduced-motion gate (EC-2).

### Phase 3 — Specialty
- **P3-1** `scripts/retro-mode-presets.json` + `scripts/lib/glyph-retro.js` — six presets (amiga-500, terminal-80s, teletext, zx-spectrum, cp437-vga, pico-8). User CONFIG wins over preset (IM-8).
- **P3-2** `scripts/lib/glyph-gpu.js` — WebGL2 compositor (atlas blit via R8 cp-grid + RGBA8 color-grid). `isSupported()` feature check with graceful CPU fallback. CR-4 validator delegates error-diffusion to CPU.

### Render.html rewrite
- Preserves v1 `drawGlyphGrid` / `sampleCell` / `applyCellFill` verbatim — critical for byte-identical regeneration under `compat: "v1"`.
- Adds `usesAdvancedPipeline(cfg)` check; only routes through `drawGlyphGridV2` when at least one v2 gate is active.
- `__glyphGridTest.getConfig` now returns `JSON.parse(JSON.stringify(CONFIG))` (EC-4). `beginRecord` accepts `{ total, fps, onFinish }` object form in addition to legacy positional.

### Documentation
- `SKILL.md` rewritten with v2 config cheatsheet, v2 request→config mapping, deep-reading index split into v1/v2 sections.
- `MIGRATION.md` added at skill root.
- References added: `pipeline.md`, `migration-compat.md`, `scene-contract-v2.md`, `glyph-sets.md`, `shape-selection.md`, `edge-aware-glyphs.md`, `dithering.md`, `xdog.md`, `crt-postprocess.md`, `retro-modes.md`, `gpu-renderer.md`, `palette-morph.md`, `recording.md`, `zones.md`, `performance-budget.md`.

### What's deferred to v3
- **T3.3 SDF glyphs** — stretch goal, not required for v2.
- **T4.2 Layered scenes** — zones approximate this for now.
- **T4.3 Audio reactivity** — blocked on user-gesture AudioContext permission (EC-11).
- **T4.4 Post-process node graph** — the CRT chain is currently linear; a graph UI would need a bigger UX rethink.
- **GPU CRT post-chain** — moved to v3; current v2 runs post on CPU after GPU readback.

### Open items
- `fonts/*.woff*` binaries not committed — users run `bash fonts/fetch-fonts.sh` once. The skill works without them (system-font fallback per `glyph-fonts.js` cascade).

## 2026-04-17 — Handoff execution (Steps 1–4)

### Step 1 — `glyph-sets/*.json` generated
`build-glyph-sets-analytical.py` produced 6 JSON files (ascii, asciiDense, blockElements, braille, octant, sextant; ~125 KB total).

### Step 2 — `fonts/*.woff*` built; fetch-fonts.sh rewritten
Upstreams changed since the script was authored:
- Microsoft Cascadia now ships only a versioned zip via GitHub releases; the old `releases/latest/download/CascadiaMono.ttf` URL 404s. We pin to `v2407.24` and extract `ttf/CascadiaMono.ttf` from the zip.
- int10h removed individual TTF downloads for the PxPlus / Px437 family; we now pull `oldschool_pc_font_pack_v2.2_linux.zip` (~15 MB) and extract `ttf - Px (pixel outline)/Px437_IBM_VGA_8x16.ttf`.
- BabelStone direct TTF download unchanged.

Output sizes smaller than predicted (tighter subset + woff2 compression): cascadia 28 KB, babelstone 8 KB, pxplus 6 KB. `WARNING: FFTM NOT subset` from pyftsubset is cosmetic (FontForge timestamp table, irrelevant for rendering).

### Step 3 — Playwright harness: 3/3 pass, ΔE94 max = 0
Goldens captured and diffed across 3 consecutive full cycles; no pixel differences.

Transient flake observed once on initial `--regen`: frame-0 golden came out as a 4 KB mostly-white PNG — i.e. the canvas was screenshotted before `setup()`'s `background()` had run. Did not reproduce on any subsequent cycle. If it returns, the fix is either to add a settle step in `capture.mjs` after `beginRecord` (wait for `frameCount >= recState.total + 1` rather than just `frameIdx >= target`), or to guard `setup()` so it never overwrites a `recState` already created by `beginRecord`.

### Step 4 — Runtime fetch paths standardized on `./` (piece-layout convention)
Piece-layout is the canonical runtime convention (`index.html` at piece root, `fonts/` `glyph-sets/` `retro-mode-presets.json` as siblings). To make the skill-dev workflow of opening `scripts/render.html` directly still work, `scripts/fonts` and `scripts/glyph-sets` are now symlinks to `../fonts` and `../glyph-sets`.

Files changed:
- `scripts/render.html`: `../glyph-sets/` → `./glyph-sets/`
- `scripts/lib/glyph-fonts.js`: three `../fonts/` → `./fonts/`
- `scripts/lib/glyph-retro.js`: `../scripts/retro-mode-presets.json` → `./retro-mode-presets.json`
- `scripts/fonts` new (symlink → `../fonts`)
- `scripts/glyph-sets` new (symlink → `../glyph-sets`)

Harness re-run post-change: all 3 frames still pass byte-identical.
