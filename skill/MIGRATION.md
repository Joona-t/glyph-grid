# MIGRATION.md — upgrading from v1 to v2

Short form. For full detail see `references/migration-compat.md`.

## What changed

v2 adds 11 pipeline stages gated behind `CONFIG.compat`. The v1 rendering code path is preserved verbatim in `render.html` and runs whenever `compat: "v1"` (explicit) or `compat: "v2"` (default) with no v2 fields set.

| New CONFIG field | What it does | Gate |
|---|---|---|
| `compat` | `"v1" | "v2"`. Single switch. | — |
| `glyphSet` | Unicode-16 sets (octant, sextant, braille, block). | `!!CONFIG.glyphSet` |
| `selectionMode` | brightness / shape / shape-edge-aware / edge-directional. | `gateShapeSelection` or `gateEdgeDirectional` |
| `dither` | ordered + error-diffusion dither. | `gateDither` |
| `prefilter` | XDoG ink-drawing style. | `gatePrefilter` |
| `postprocess` | CRT + bloom + scanlines + aberration etc. | `gatePostprocess` |
| `retroMode` | preset genre modes. | `gateRetroMode` |
| `renderer` | `"cpu"` | `"gpu"`. | `gateGPU` |
| `zones` | zone-variable CONFIG per scene. | `gateZones` |
| `paletteMorph` | OKLab palette interpolation. | `gatePaletteMorph` |
| `recording` | streaming (File System Access / fflate / JSZip). | `gateStreamingRecord` |

## Frozen pieces

Keep your existing CONFIG unchanged and you get the v1 path automatically. To be explicit / pin behavior:

```js
CONFIG.compat = "v1";
```

That short-circuits every v2 gate.

## Adopting v2 in existing pieces

1. Leave `compat` unset (defaults to `"v2"`).
2. Add v2 fields one at a time; each has an inert default.
3. Re-run the piece; compare frame 0 before/after with `harness/run.mjs`.

## Breaking changes to the test hook

Preserved:
- `__glyphGridTest.beginRecord(total, onFinish)` — still works.
- `__glyphGridTest.setConfig(overrides)` — still works.
- `__glyphGridTest.getRecState()` — still works.

Changed:
- **`__glyphGridTest.getConfig()` now returns a deep clone** (EC-4). Previously returned a live reference; callers that mutated it corrupted state.
- `beginRecord` accepts `{ total, fps, onFinish }` object in addition to the legacy `(total, onFinish)` positional form.

Added:
- `__glyphGridTest.getSkillVersion()` → `"2.0.0"`.

## Font changes

v2 ships `fonts/cascadia-mono-subset.woff2`, `fonts/babelstone-pseudographica-subset.woff2`, `fonts/pxplus-ibm-vga8.woff`. These are fetched at setup when v2 is active AND `CONFIG.glyphSet` is set. Under v1 (or v2 without `glyphSet`) the font loader is not invoked; the browser uses whatever `CONFIG.font.family` resolves to.

Run `bash fonts/fetch-fonts.sh` once to download + subset the source TTFs. Outputs go into `fonts/`. See `fonts/README.md`.

## Glyph set JSONs

Under `glyph-sets/`. Regenerate via:

- `python3 scripts/build-glyph-sets.py --font fonts/sources/CascadiaMono.ttf --out glyph-sets` — font-based; authoritative.
- `python3 scripts/build-glyph-sets-analytical.py --out glyph-sets` — font-free; works for procedural sets (braille, sextant, octant, blockElements, ASCII).

## Checking byte-identity

```bash
cd harness
npm install && npx playwright install chromium
node run.mjs --regen   # captures goldens from current v2 code with compat:v1
# commit the goldens
node run.mjs           # future runs: fail if any piece drifts
```

## When NOT to upgrade a piece

- It ships a custom scene that relies on implementation details of v1 sampling (e.g., reaches into private functions).
- You've already exported a production loop and any pixel drift is unacceptable.
- You need cross-OS / cross-browser parity WITHOUT deploying the bundled fonts (v1 + system fonts + same-OS-only shipping works; v2 adds better guarantees but only when the fonts are served).

## When TO upgrade

- You want octants, better density, shape matching, CRT aesthetics, retro modes, or GPU scaling.
- You want streaming recording (no more 8-second recording cap).
- You want cross-browser byte-identity (bundled Cascadia eliminates OS font drift).

## Getting help

`BUGS_AND_ITERATIONS.md` documents every known issue with root cause + fix. `references/` has deep-dive docs for each subsystem. If something doesn't work, the harness tells you what drifted (ΔE94 histogram) and which piece.
