# Glyph-Grid

> Single-file p5.js renderer that produces character-grid ASCII overlays on top of pixel-rendered geometric scenes. Double-click `index.html` to run.

A two-layer compositing tool. A real geometric scene (parametric curves, Perlin noise bands, particle flows) renders into an offscreen `p5.Graphics` buffer at full resolution. A second pass walks an `N×M` grid over that buffer, samples each cell's color (as RGB distance from the palette background), picks a glyph from a density ramp, and draws it on the visible canvas — *preserving the source color* so cyan stays cyan and pink stays pink instead of going muddy gray.

Animate it by re-rendering the source per frame. Export by capturing PNGs into a ZIP and stitching with `ffmpeg`.

The whole renderer is one HTML file. p5.js and JSZip load from CDN. No npm, no build, no webpack. Open the file in a browser, edit the `CONFIG` object at the top, reload.

---

## Quick start

```bash
# Just open it
open index.html       # macOS
start index.html      # Windows
xdg-open index.html   # Linux
```

The default config renders a `caduceusHelix` scene (vertical staff + counter-rotating helices + noise wing-band) in the `monochrome` palette (white on black) at 100×100 grid density. Edit the `CONFIG` object at the top of `index.html` and reload to change anything.

## Configuration

Every knob lives in the `CONFIG` object at the top of `index.html`, with an inline comment justifying each default. The shape:

```js
const CONFIG = {
  canvas: { w: 800, h: 800 },
  grid:   { cols: 100, rows: 100 },
  font:   { family: 'monospace', size: 10 },
  ramp: 'classic',                  // 'classic' | 'dense' | 'sparse' | 'unicode-block'
  brightnessGamma: 0.5,             // pow curve on signal — lower = denser glyphs
  samplingStrategy: 'average',      // 'average' | 'nearest' | 'edge-weighted'
  colorMode: 'preserve',            // 'preserve' | 'monochrome' | 'duotone'
  palette: 'monochrome',            // 'monochrome' | 'phosphor' | 'bauhaus' | 'lovespark' | 'mono-amber'
  scene: 'caduceusHelix',           // 'caduceusHelix' | 'flowField' | 'concentricRings'
  animation: { fps: 30, duration: 4.0, loop: true },
  seed: 1337,
  record: false,
};
```

There is no other source of truth: no localStorage, no URL params, no UI controls. Edit, save, reload.

## Scenes, palettes, ramps

- **Scenes**: `caduceusHelix`, `flowField`, `concentricRings`. Adding a scene is a 10-line function — see `scripts/render.html` and the locked scene contract `scene(g, t, config) => void`.
- **Palettes**: `monochrome` (default — palette-agnostic white on black), `phosphor` (green CRT), `bauhaus` (red/blue/yellow on cream), `lovespark` (the LoveSpark suite's pink/magenta/cyan), `mono-amber` (amber CRT).
- **Ramps**: `classic` (Paul Bourke's `' .·:-=+*#%@'`), `dense`, `sparse`, `unicode-block` (`' ░▒▓█'`).
- **Sampling**: `average` (smoothest), `nearest` (fastest), `edge-weighted` (Sobel boost).
- **Color modes**: `preserve` (vivid sampled hues, normalized as delta-from-bg), `monochrome` (single ink with brightness alpha), `duotone` (lerp between two inks).

## Recording a loop to GIF

1. In `index.html`, set `CONFIG.record = true`. Optionally adjust `animation.duration` and `animation.fps` (defaults: 4 seconds × 30 fps = 120 frames).
2. Reload the page in your browser. The renderer enters deterministic record mode, runs the animation once, and downloads a single ZIP containing `frame_0001.png` … `frame_0120.png`.
3. Unzip into a `frames/` directory:

   ```bash
   mkdir frames && unzip glyph-grid_*.zip -d frames/
   ```

4. Stitch with the included script:

   ```bash
   bash export-gif.sh frames/ out.gif 30
   ```

   This uses ffmpeg's two-pass `palettegen` + `paletteuse` with Bayer dither — sharp on character-grid output, no error-diffusion smearing. Requires `ffmpeg` in your `PATH`.

5. Set `CONFIG.record = false` again before the next live preview.

## Reusable Claude Code skill

This renderer is also installed as a reusable Claude Code skill at `~/.claude/skills/glyph-grid/`:

```
~/.claude/skills/glyph-grid/
├── SKILL.md                        # lean entry point, triggers on "ASCII art generator", etc.
├── references/
│   ├── technique.md                # the two-layer technique + scene contract
│   └── scenes.md                   # three annotated scene patterns
└── scripts/
    ├── render.html                 # verbatim copy of index.html, used as a template
    └── export-gif.sh               # verbatim copy of export-gif.sh
```

Trigger phrases like *"make me an ASCII art piece with a flow field"* or *"glyph-based visualization in the style of @macbethAI"* will auto-load the skill in a fresh Claude Code session, scaffold a new sketch from `scripts/render.html`, and edit the `CONFIG` to match the request.

---

## Aesthetic lineage

This technique is decades old. Crediting the tradition:

- **Kyle McDonald** — long-running ASCII / character-grid art research, `ofxAsciiArt`.
- **Michael Fogleman** (fogleman) — character-grid renderers, geometric reductions.
- **Demoscene terminal art** — decades of glyph-density-as-shading on text-mode displays.
- **@macbethAI** — recent practitioner whose work prompted this specific build. *Not* the source of the technique.

This repo doesn't claim to copy any specific piece. It's a tool for exploring the technique.

---

## License

[MIT](./LICENSE) — Joona, 2026.
