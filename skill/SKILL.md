---
name: glyph-grid
description: Use when the user asks for ASCII art, character-grid renderers, glyph-density shading, p5.js generative text art, or anything in the style of @macbethAI / Kyle McDonald / fogleman. Scaffolds a new single-file p5.js sketch from the glyph-grid template, edits the CONFIG to match the request, and renders it. v2 adds Unicode 16 octants, shape-vector selection, dithering, XDoG, CRT post-process, retro modes, and a GPU path — all behind `CONFIG.compat` so v1 pieces stay byte-identical. Also handles Sparky (LoveSpark mascot) glyph portraits. Trigger phrases: "make me an ASCII art piece", "glyph-grid sketch", "character-grid visualization", "ASCII portrait of sparky", "p5.js flow field in ascii", "text-mode art", "CRT terminal ascii", "octant art".
---

# glyph-grid — reusable p5.js ASCII / Unicode-art renderer skill

This skill packages a single-file p5.js renderer that composites animated geometric scenes as character-grid overlays, preserving source color. Two layers: a real `p5.Graphics` buffer holds the scene, and a sampling pass walks an N×M grid, picks a glyph per cell, and draws it colored from the source. No framework, no build — one HTML file plus the `lib/` folder of modular add-ons.

**v2.0.0** adds 11 new pipeline stages (shape-vector selection, dithering, XDoG, CRT post chain, retro modes, GPU path, streaming recording, and more). A single switch — `CONFIG.compat: "v1" | "v2"` — gates every new stage. Pieces rendered under `compat: "v1"` are byte-identical to the pre-upgrade output. The v2 default leaves new stages inert unless you opt in.

**Inspired by [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent)** and the [agentskills.io](https://agentskills.io) open standard. Rendering technique from Kyle McDonald's `ofxAsciiArt`, fogleman's geometric reductions, demoscene terminal art, @macbethAI, and Alex Harri's 2024 shape-vector method.

## When to use this skill

Trigger phrases:

- "Make me an ASCII art piece with a flow field"
- "Glyph-based visualization in the style of @macbethAI"
- "Character-grid renderer", "text-mode art", "density-ramp shading"
- "ASCII portrait of Sparky" / "Sparky as glyph-grid"
- "p5.js generative art that uses characters instead of pixels"
- "Animated ASCII loop I can export to GIF"
- "Terminal CRT aesthetic", "retro teletext/Amiga/ZX look"
- "Octant art" / "Unicode block art"

If the request is just static ASCII text (logo, block comment, banner) this is the **wrong** skill.

## How to use it (scaffold → edit → render)

The template lives at `scripts/render.html`. It imports modular libs from `scripts/lib/`. When scaffolding a piece, copy BOTH.

### Standard workflow

1. **Create a working directory.** Something descriptive like `~/glyph-grid-pieces/flow-field-phosphor/`. Don't scaffold into `~/.claude/skills/` itself.

2. **One-time skill setup** (run once; populates binary artifacts).
   ```bash
   cd ~/.claude/skills/glyph-grid
   bash fonts/fetch-fonts.sh                                 # WOFF2 subsets
   python3 scripts/build-glyph-sets-analytical.py --out glyph-sets   # 6 JSON files
   ```
   Skip `fetch-fonts.sh` if you never plan to use Unicode 16 octants — the system-font fallback works for ASCII/braille/block. Skip the Python step and v2 shape-vector selection will silently fall back to brightness mode.

3. **Copy the template + libs + glyph sets + fonts.**
   ```bash
   mkdir -p <dir>/{lib,glyph-sets,fonts,assets}
   cp ~/.claude/skills/glyph-grid/scripts/render.html <dir>/index.html
   cp ~/.claude/skills/glyph-grid/scripts/export-gif.sh <dir>/
   cp ~/.claude/skills/glyph-grid/scripts/lib/*.js <dir>/lib/
   cp ~/.claude/skills/glyph-grid/scripts/retro-mode-presets.json <dir>/
   cp ~/.claude/skills/glyph-grid/glyph-sets/*.json <dir>/glyph-sets/ 2>/dev/null
   cp ~/.claude/skills/glyph-grid/fonts/*.woff* <dir>/fonts/ 2>/dev/null
   cp ~/.claude/skills/glyph-grid/fonts/LICENSE <dir>/fonts/
   cp ~/.claude/skills/glyph-grid/assets/sparky.png <dir>/assets/
   ```

3. **Edit `CONFIG`** at the top of `index.html`. Every knob is commented inline. Most common edits:

   **v1 / shared fields:**
   - `scene`: `'caduceusHelix' | 'flowField' | 'concentricRings' | 'sparkyPortrait'`
   - `palette`: `'monochrome' | 'phosphor' | 'bauhaus' | 'lovespark' | 'mono-amber'`
   - `ramp`: `'classic' | 'dense' | 'sparse' | 'unicode-block'`
   - `colorMode`: `'preserve' | 'monochrome' | 'duotone'`
   - `samplingStrategy`: `'average' | 'nearest' | 'edge-weighted'`
   - `grid.cols/rows`: density, default 100×100
   - `brightnessGamma`: 0.3 (aggressive) → 1.0 (linear)
   - `seed`: change for a different instance

   **v2 fields (opt-in):**
   - `compat`: `"v1"` (frozen) | `"v2"` (default, gates inert without fields)
   - `glyphSet`: `'ascii' | 'asciiDense' | 'boxDrawing' | 'blockElements' | 'braille' | 'sextant' | 'octant' | 'cp437'`
   - `selectionMode`: `'brightness' | 'shape' | 'shape-edge-aware' | 'edge-directional'`
   - `dither`: `{ mode: 'none' | 'bayer4' | 'bayer8' | 'blueNoise' | 'temporal' | 'floydSteinberg' | 'atkinson' | 'jarvisJudiceNinke' }`
   - `prefilter`: `{ mode: 'xdog', sigma, k, tau, phi, epsilon }`
   - `postprocess`: `{ scanlines: {...}, bloom: {...}, phosphorDecay: {...}, chromaticAberration: {...}, barrel: {...}, vignette: {...} }`
   - `retroMode`: `'amiga-500' | 'terminal-80s' | 'teletext' | 'zx-spectrum' | 'cp437-vga' | 'pico-8'`
   - `renderer`: `'cpu'` (default) | `'gpu'`
   - `paletteMorph`: `{ enabled: true, palettes: [...] }`
   - `zones`: `{ enabled: true, 1: {...}, 2: {...} }`

4. **New scenes** must keep the locked signature:
   ```
   scene(g: p5.Graphics, t: number, config: CONFIG) => void
   ```
   v2 optionally returns `{ zones: p5.Graphics }` for zone-variable pipelines — see `references/scene-contract-v2.md`.

5. **Render.** Open `index.html` in a browser. No server required unless you need headless screenshotting, in which case:
   ```bash
   cd <dir> && python3 -m http.server 8765 &
   # then hit http://localhost:8765/index.html
   ```

6. **Export.** Set `CONFIG.record = true`, reload. The legacy JSZip path still works for v1 pieces. For v2 streaming recording, set `CONFIG.recording.mode = "auto"` — picks File System Access API, then fflate, then JSZip.

## Request → CONFIG cheatsheet

| User says… | Suggested CONFIG |
|---|---|
| "green CRT flow field" | `scene: 'flowField', palette: 'phosphor', ramp: 'dense'` |
| "sparky in pink ascii" | `scene: 'sparkyPortrait', palette: 'lovespark'` (default) |
| "bauhaus concentric circles" | `scene: 'concentricRings', palette: 'bauhaus', colorMode: 'preserve'` |
| "amber terminal helix" | `scene: 'caduceusHelix', palette: 'mono-amber', ramp: 'classic'` |
| "eye of ra / ankh / specific icon" | **image-composite pattern** — see `references/image-composite.md` |
| "denser / more detail" | bump `grid.cols/rows` to 120–140 |
| "highlight edges more" | `samplingStrategy: 'edge-weighted'` |
| "make it feel hand-drawn / sparse" | `ramp: 'sparse', brightnessGamma: 0.3` |
| "loop slower" | raise `animation.duration` (default 4.0s) |
| **v2:** "octant art with shape matching" | `compat: 'v2', glyphSet: 'octant', selectionMode: 'shape'` |
| **v2:** "XDoG ink-drawing style" | `prefilter: { mode: 'xdog', sigma: 1.2 }, selectionMode: 'shape-edge-aware'` |
| **v2:** "pure 80s CRT terminal" | `retroMode: 'terminal-80s'` |
| **v2:** "animated palette across the loop" | `paletteMorph: { enabled: true, palettes: ['lovespark', 'phosphor'] }` |
| **v2:** "GPU-accelerated" | `renderer: 'gpu'` |

## Decision: parametric geometry vs image-composite

Unchanged from v1:

- **Specific iconographic symbol** (Eye of Horus, ankh, Sparky, a logo) → **image-composite pattern.** Find a reference PNG, preprocess with zone-masked colors, composite over dynamic glow. See `references/image-composite.md`.
- **Abstract generative piece** → parameterize an existing scene (see `references/scenes.md`).

## Deeper reading

### v1 foundations

- `references/technique.md` — two-layer composite, scene contract, signal-from-bg, preserve color mode.
- `references/scenes.md` — annotated v1 scenes.
- `references/image-composite.md` — Pattern 5 for iconographic references.

### v2 additions

- `references/pipeline.md` — canonical stage order + seed-consumption rules (IM-2).
- `references/migration-compat.md` — how `compat: "v1" | "v2"` works (IM-1).
- `references/scene-contract-v2.md` — zones-returning scenes (IM-4).
- `references/glyph-sets.md` — Unicode sets + 6D shape vector spec (T1.3).
- `references/shape-selection.md` — Harri 2024 unified method (T1.1, CR-10).
- `references/edge-aware-glyphs.md` — Sobel + directional alphabet, Rec.709 math (T1.2, CR-1).
- `references/dithering.md` — dither modes + GPU restriction (T1.4, CR-4, CR-6).
- `references/xdog.md` — Extended DoG prefilter (T2.1, CR-5).
- `references/zones.md` — zone-variable CONFIG (T2.3).
- `references/palette-morph.md` — OKLab palette interpolation (T2.4).
- `references/crt-postprocess.md` — CRT chain + loop pre-roll (T2.2, CR-8, CR-9).
- `references/retro-modes.md` — preset genre modes (T3.1).
- `references/gpu-renderer.md` — WebGL2 path (T3.2).
- `references/recording.md` — streaming recording (IM-5).
- `references/performance-budget.md` — frame-time targets + CPU↔GPU crossover.

### Infrastructure

- `fonts/README.md` — bundled WOFF subsets (Cascadia Mono, BabelStone, PxPlus IBM VGA).
- `harness/README.md` — headless regression harness (Playwright + ΔE94).
- `BUGS_AND_ITERATIONS.md` — every CR-*, IM-*, and bug fix with date + root cause + fix.
- `MIGRATION.md` — v1 → v2 upgrade notes (short form).

## Hard rules

- **Never write per-frame state inside a scene.** Scenes must be pure functions of `(g, t, config)`. Record mode relies on determinism.
- **Never change the scene contract signature.** It's locked. v2 adds an optional return value (`{ zones }`), not a new parameter.
- **Always pass colors through `inkColor(config, i)`**, not hex literals.
- **Don't import frameworks.** Single HTML file + CDN + local `lib/` is the skill.
- **v1 pieces:** set `CONFIG.compat = "v1"` to opt out of v2 gates entirely. The regression harness (`harness/run.mjs`) verifies byte-identical output for frozen pieces.
- **Default grid is 100×100** at 800×800 canvas. Bump font size if density increases.
- **No `Math.random()`, no `Date.now()`** for state. Use `CONFIG.seed` + `hash32(seed, frameIdx, ...)` for temporal jitter (IM-9).

## Attribution

Part of the [LoveSpark suite](https://github.com/Joona-t). Repo: `Joona-t/glyph-grid`.

SKILL_VERSION: 2.0.0.
