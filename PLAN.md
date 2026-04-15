# Glyph-Grid — Plan

> Single-file p5.js renderer that produces character-grid ASCII overlays on top of pixel-rendered geometric scenes. Two artifacts ship together: this **renderer repo** (the proof + template source) and a reusable **Claude Code skill** at `~/.claude/skills/glyph-grid/` that codifies the technique.

## Technique (the one paragraph that matters)

Two-layer composite, **not** a single-pass ASCII converter. A real p5.js scene draws into an offscreen `p5.Graphics` buffer (full resolution, normal geometry — lines, parametric curves, noise bands). A second pass divides that buffer into an `N×M` grid, samples each cell's brightness (and optionally dominant color or Sobel edge magnitude), picks a glyph from a density ramp like `" .·:-=+*#%@"`, and renders it on the visible canvas with the source color preserved. Animation = re-render the source per frame, re-sample the grid. Export = capture frames to PNGs, stitch with ffmpeg.

## Phases

| Phase | Builds | Exit criterion |
|---|---|---|
| **0** | `PLAN.md`, `README.md`, `LICENSE` (MIT), `.gitignore`, empty `index.html`, `git init` | Joona signs off on layout. No code runs yet. |
| **1** | Minimal renderer: `caduceusHelix` only, `classic` ramp, `average` sampling, `preserve` color, `monochrome` palette, **no animation**. CONFIG stub with inline justifications. | (a) Static frame visually matches the technique. (b) **Perf**: 120×120 grid on 1080×1080 buffer samples in <30ms. If not, renegotiate before Phase 2a. |
| **2a** | Lock the scene contract `scene(g, t, config) => void`. 4 ramps, 3 sampling strategies (`average`/`nearest`/`edge-weighted`), 3 color modes (`preserve`/`monochrome`/`duotone`), 5 palettes (`monochrome` default + `phosphor`/`bauhaus`/`lovespark`/`mono-amber`), animation loop. Still only the helix. | All knobs work on the helix × all palettes × all color modes. Loop seamless at `t = duration`. |
| **2b** | `flowField` + `concentricRings` against the **locked** contract. No contract changes allowed; if it cracks, revisit 2a. | All three scenes animate at target fps × at least 2 palettes each. |
| **3** | `record` mode → deterministic PNG capture → JSZip → single download. `export-gif.sh` ffmpeg one-liner with palettegen/paletteuse. | 4-second loop records, unzips, stitches to a clean looping GIF on disk. |
| **4** | Extract to `~/.claude/skills/glyph-grid/`: lean `SKILL.md` + `references/technique.md` (with the **scene contract**) + `references/scenes.md` + `scripts/render.html` (verbatim copy) + `scripts/export-gif.sh`. | Fresh Claude Code session: "make me a glyph-grid piece with concentric rings in green-on-black" → skill auto-loads, scaffolds from template, piece renders. |

## Scene function contract (locked at Phase 2a, do not change in 2b+)

```
scene(g: p5.Graphics, t: number, config: CONFIG) => void
```

- `g` — the offscreen source buffer; the function draws into it, mutates in place
- `t` — seconds since loop start, wraps at `config.animation.duration` so loops are seamless
- `config` — full CONFIG passed through so scenes can read palette, dimensions, etc.
- Return value ignored. The glyph-grid pass reads `g.pixels` after the scene returns.

This is the extension point. Everything reusable about this tool is downstream of these three parameters being right.

## Constraints

- Single-file, no build step, no npm. Only CDN loads (p5.js, JSZip).
- Carmack-style spec discipline: every CONFIG field has an inline comment explaining *what it controls* and *why this default*.
- No `localStorage` or session state; all config in `CONFIG`.
- Default palette is `monochrome` (white on black). LoveSpark pink/cyan ships as the named `lovespark` preset, swappable via one CONFIG field. The tool is palette-agnostic — LoveSpark is the brand, not the aesthetic.
- MIT license.
- Attribution credits the **tradition**: Kyle McDonald's ASCII work, fogleman's character-grid renderers, demoscene terminal art. @macbethAI is named as a recent practitioner whose work prompted this build, **not** as the source of the technique.

## Review gates

After every phase: pause, summarize *built / skipped / surprised / what next phase needs from Joona*. Nothing ships past Phase 4 without explicit Linus sign-off.
