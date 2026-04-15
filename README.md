# Glyph-Grid

> Single-file p5.js renderer that produces character-grid ASCII overlays on top of pixel-rendered geometric scenes. Double-click `index.html` to run.

**Status:** scaffold. Phase 0 of [PLAN.md](./PLAN.md). No rendering logic yet.

---

## What it is

A two-layer compositing tool. A real geometric scene (parametric curves, Perlin noise bands, particle flows) renders into an offscreen buffer at full resolution. A second pass walks an `N×M` grid over that buffer, samples each cell's brightness and color, picks a glyph from a density ramp, and draws it on the visible canvas. The result is a character-grid overlay that *preserves the source color* — magenta stays magenta, cyan stays cyan — instead of the muddy gray most ASCII converters produce.

Animate it by re-rendering the source per frame. Export by capturing PNGs and stitching with `ffmpeg`.

The whole renderer is one HTML file. p5.js loads from a CDN. No npm, no build, no webpack. Open the file in a browser, edit the `CONFIG` object at the top, reload.

## Quick start

*(coming in Phase 1)*

```bash
# Just open it
open index.html
```

## Configuration

*(coming in Phase 2a — full CONFIG schema with inline comments justifying every default)*

## Recording a loop to GIF

*(coming in Phase 3 — `CONFIG.record = true`, click record, get a ZIP, run `export-gif.sh`)*

## Reusable Claude Code skill

*(coming in Phase 4 — installed at `~/.claude/skills/glyph-grid/`, loads on requests like "make me ASCII art in the style of X")*

---

## Aesthetic lineage

This technique is old. Crediting the tradition rather than any one practitioner:

- **Kyle McDonald** — long-running ASCII / character-grid art and `ofxAsciiArt`
- **Michael Fogleman** (fogleman) — character-grid renderers and `primitive`-style geometric reductions
- **Demoscene terminal art** — decades of glyph-density-as-shading on text-mode displays
- **@macbethAI** — recent practitioner whose work prompted this specific build

This repo doesn't claim to copy any specific piece. It's a tool for exploring the technique.

---

## License

[MIT](./LICENSE) — Joona, 2026.
