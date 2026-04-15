---
name: glyph-grid
description: Use when the user asks for ASCII art, character-grid renderers, glyph-density shading, p5.js generative text art, or anything in the style of @macbethAI / Kyle McDonald / fogleman. Scaffolds a new single-file p5.js sketch from the glyph-grid template, edits the CONFIG to match the request, and renders it. Also handles Sparky (LoveSpark mascot) glyph portraits. Trigger phrases: "make me an ASCII art piece", "glyph-grid sketch", "character-grid visualization", "ASCII portrait of sparky", "p5.js flow field in ascii", "text-mode art".
---

# glyph-grid — reusable p5.js ASCII renderer skill

This skill packages a single-file p5.js renderer that composites animated geometric scenes as character-grid overlays, preserving source color. Two layers: a real p5.Graphics buffer holds the scene, and a sampling pass walks an N×M grid, picks a glyph from a density ramp per cell, and draws it colored from the source. No framework, no build — one HTML file, p5.js + JSZip from CDN.

**Inspired by [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent)** and the [agentskills.io](https://agentskills.io) open standard — the idea of shipping creative techniques as portable skill files comes from that project. The rendering technique itself is older: Kyle McDonald's `ofxAsciiArt`, fogleman's geometric reductions, demoscene terminal art, and recent work by @macbethAI.

## When to use this skill

Trigger phrases (non-exhaustive):

- "Make me an ASCII art piece with a flow field"
- "Glyph-based visualization in the style of @macbethAI"
- "Character-grid renderer", "text-mode art", "density-ramp shading"
- "ASCII portrait of Sparky" / "Sparky as glyph-grid"
- "p5.js generative art that uses characters instead of pixels"
- "Animated ASCII loop I can export to GIF"

If the request is just *static ASCII text* (a logo, a block comment, a text-mode banner) this is the **wrong** skill — use a text-mode generator. This skill is for **rendered pixel geometry sampled into a glyph grid**, which is different.

## How to use it (scaffold → edit → render)

The template lives at `scripts/render.html`. It's a verbatim copy of the public `Joona-t/glyph-grid` repo's `index.html` and contains the full renderer + four scenes (`caduceusHelix`, `flowField`, `concentricRings`, `sparkyPortrait`) + five palettes.

**Standard workflow:**

1. **Create a working directory** for the piece. Pick something descriptive like `~/glyph-grid-pieces/flow-field-phosphor/` or inside the user's current project. Don't scaffold into `~/.claude/skills/` itself — the skill files are the template, not the artifact.

2. **Copy the template** and its assets:
   ```bash
   mkdir -p <dir>/assets
   cp ~/.claude/skills/glyph-grid/scripts/render.html <dir>/index.html
   cp ~/.claude/skills/glyph-grid/scripts/export-gif.sh <dir>/
   cp ~/.claude/skills/glyph-grid/assets/sparky.png <dir>/assets/
   ```
   The Sparky PNG is only needed if the request involves Sparky. Copy it anyway — it's 150KB and keeps the template self-contained.

3. **Edit `CONFIG`** at the top of the copied `index.html` to match the request. The object is commented inline — every knob has a justification. Typical edits:
   - `scene`: `'caduceusHelix' | 'flowField' | 'concentricRings' | 'sparkyPortrait'`
   - `palette`: `'monochrome' | 'phosphor' | 'bauhaus' | 'lovespark' | 'mono-amber'`
   - `ramp`: `'classic' | 'dense' | 'sparse' | 'unicode-block'`
   - `colorMode`: `'preserve' | 'monochrome' | 'duotone'`
   - `samplingStrategy`: `'average' | 'nearest' | 'edge-weighted'`
   - `grid.cols/rows`: density, default 100×100
   - `brightnessGamma`: 0.3 (aggressive) → 1.0 (linear)
   - `seed`: change for a different instance of the same scene

4. **If the request asks for a new scene that doesn't exist**, add a function to the `SCENES` object. It must implement the locked contract:
   ```
   scene(g: p5.Graphics, t: number, config: CONFIG) => void
   ```
   See `references/technique.md` for the full contract and `references/scenes.md` for three annotated scene patterns to adapt from.

5. **Render.** The file is static HTML — no server needed for a live preview:
   ```bash
   open <dir>/index.html   # macOS
   ```
   Or serve it over HTTP if you need headless screenshotting:
   ```bash
   cd <dir> && python3 -m http.server 8765 &
   # then hit http://localhost:8765/index.html
   ```

6. **To export a GIF**, set `CONFIG.record = true`, reload the page. The renderer runs deterministically, builds a ZIP of PNG frames, downloads it. Unzip into `frames/` then run `bash export-gif.sh frames/ out.gif 30`. Requires `ffmpeg` in PATH.

## Request → CONFIG mapping cheatsheet

| User says… | Suggested CONFIG |
|---|---|
| "green CRT flow field" | `scene: 'flowField', palette: 'phosphor', ramp: 'dense'` |
| "sparky in pink ascii" | `scene: 'sparkyPortrait', palette: 'lovespark'` (this is the default) |
| "bauhaus concentric circles" | `scene: 'concentricRings', palette: 'bauhaus', colorMode: 'preserve'` |
| "amber terminal helix" | `scene: 'caduceusHelix', palette: 'mono-amber', ramp: 'classic'` |
| "denser / more detail" | bump `grid.cols/rows` to 120 or 140 |
| "chunkier / blockier" | `ramp: 'unicode-block'` or drop `cols/rows` to 70 |
| "highlight edges more" | `samplingStrategy: 'edge-weighted'` |
| "make it feel hand-drawn / sparse" | `ramp: 'sparse', brightnessGamma: 0.3` |
| "loop slower" | raise `animation.duration` (default 4.0s) |

## Deeper reading

- `references/technique.md` — the two-layer composite, the scene contract, why `signal-from-bg` is the right primitive, and how `preserve` color mode normalizes deltas so pink-on-black stays pink and dark-on-cream doesn't invert.
- `references/scenes.md` — annotated walkthroughs of the four built-in scenes, showing the common shape: parameterize on `t`, no per-frame state, use `inkColor(config, i)` so the scene works on any palette.

## Hard rules

- **Never write per-frame state inside a scene.** Scenes must be pure functions of `(g, t, config)`. Record mode relies on determinism.
- **Never change the scene contract signature.** It's locked. If you need more inputs, add them to `config`, not the signature.
- **Always pass colors through `inkColor(config, i)`**, not hex literals, so scenes respect palette swaps.
- **Don't import frameworks.** This skill's whole point is "single HTML file, CDN scripts, no build." If the user wants React/Vue/Tailwind, route them to a different skill.
- **Default grid is 100×100.** It's the sweet spot for the 800×800 canvas at 10px font. If you bump grid density, consider bumping font size too.

## Attribution

Part of the [LoveSpark suite](https://github.com/Joona-t). Repo: `Joona-t/glyph-grid`.
