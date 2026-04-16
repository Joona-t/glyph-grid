# retro-modes.md — preset genre modes

## Purpose

A single `CONFIG.retroMode: "<name>"` flips glyph set, palette, selection mode, and post-process settings in one line. Presets encode well-known aesthetics with sensible defaults.

## Available modes

See `scripts/retro-mode-presets.json` for the full specs.

| Mode | Glyph set | Palette size | Key post | Best for |
|---|---|---|---|---|
| `amiga-500` | blockElements | 32 | scanlines + bloom + vignette | chunky-pixel aesthetic |
| `terminal-80s` | asciiDense | 6 (greens) | phosphor decay + scanlines + halation + barrel + vignette | old CRT terminal |
| `teletext` | blockElements | 8 (TV primaries) | none (flat) | Ceefax-era BBC look |
| `zx-spectrum` | blockElements | 15 | scanlines | ZX Spectrum color clash era |
| `cp437-vga` | cp437 | 16 (DOS) | scanlines + bloom | DOS textmode |
| `pico-8` | braille | 16 | bloom | fantasy console |

## Precedence (per IM-8)

The order is:

1. **Skill defaults** (baked into render.html).
2. **Retro preset** (applied if `retroMode !== "none"`).
3. **User CONFIG** (wins over preset).

So a user can pick `retroMode: "terminal-80s"` AND override the palette:

```js
CONFIG.retroMode = "terminal-80s";
CONFIG.palette = "mono-amber";          // overrides the preset's green
```

This works because `glyph-retro.resolve()` merges preset fields first, then lets user fields win.

## Loading

`glyph-retro.load(modeName, userConfig)` returns a promise that resolves once presets are fetched. Presets are cached per session.

For the monolithic single-file build, you can avoid the fetch round-trip by baking presets inline:

```html
<script>
  window.__GlyphGridRetroPresets = { /* paste retro-mode-presets.json content */ };
</script>
<script src="lib/glyph-retro.js"></script>
```

The loader prefers inline presets over fetch.

## Adding a new mode

1. Edit `scripts/retro-mode-presets.json`.
2. Add an entry like:
   ```json
   "my-preset": {
     "description": "what this looks like",
     "glyphSet": "...",
     "selectionMode": "...",
     "palette": [...],
     "postprocess": { ... }
   }
   ```
3. Retro-mode presets can declare their own `palette` array — no need to register in PALETTES.
4. Document in this file.

## Interplay with `compat: "v1"`

Retro modes are a v2-only feature. Under `compat: "v1"`, `gateRetroMode()` returns false and the preset is ignored. This keeps frozen pieces byte-identical — they never see retro-mode merging.
