# scene-contract-v2.md

## v1 contract (unchanged, locked)

```js
scene(g: p5.Graphics, t: number, config: CONFIG) => void
```

- `g`: offscreen source buffer. Draw into it; mutate in place. Own random/noise state (seeded in setup) — call `g.random`, `g.noise`, not global.
- `t`: seconds since loop start; wraps at `config.animation.duration`.
- `config`: full CONFIG. Read palette via `inkColor(config, i)` / `bgColor(config)`.

Return value ignored. The glyph-grid pass calls `g.loadPixels()` after the scene returns.

## v2 contract (additive, opt-in)

```js
scene(g: p5.Graphics, t: number, config: CONFIG) => { zones?: p5.Graphics } | void
```

If the scene returns `{ zones }`, the loader captures `zones` as a second p5.Graphics buffer whose R channel encodes a zone ID (0–255) per pixel. Downstream stages look up `CONFIG.zones[id]` to get per-zone overrides for glyph set, selection mode, palette, etc.

Other channels of the zones buffer (G/B/A) are reserved for future expansion; don't rely on them.

## Minimal v2 example

```js
const SCENES = {
  splitPortrait(g, t, config) {
    g.background(bgColor(config));
    g.noStroke();

    // Paint into src.
    g.fill(inkColor(config, 0));
    g.rect(0, 0, g.width / 2, g.height);
    g.fill(inkColor(config, 1));
    g.rect(g.width / 2, 0, g.width / 2, g.height);

    // Build zone buffer — 1 on the left half, 2 on the right.
    const z = createGraphics(g.width, g.height);
    z.pixelDensity(1);
    z.noStroke();
    z.fill(1, 1, 1); z.rect(0, 0, g.width / 2, g.height);
    z.fill(2, 2, 2); z.rect(g.width / 2, 0, g.width / 2, g.height);
    return { zones: z };
  },
};

CONFIG.scene = 'splitPortrait';
CONFIG.zones = {
  enabled: true,
  1: { glyphSet: 'braille', selectionMode: 'shape', palette: 'lovespark' },
  2: { glyphSet: 'octant',  selectionMode: 'shape', palette: 'phosphor' },
};
```

## Zone-boundary blending (EC-7)

Adjacent zones produce a hard visual transition by default. To soften:

- Sample the zone buffer with bilinear interpolation.
- Non-integer zone IDs fall between two zone configs.
- Render both outputs for the cell; blend by the fractional distance.

`glyph-zones.sampleCell()` returns `{ primary, secondary, mix }` for this purpose; the render.html dispatcher applies the blend automatically.

## Legacy scenes and v2

A v1 scene that does NOT return a zones buffer falls through gracefully when `CONFIG.zones.enabled: true`: the whole canvas is treated as zone 0 and the base CONFIG applies.

## Determinism

The zones buffer must be deterministic. If you use any randomness in its construction, feed from `CONFIG.seed` (hash it, don't draw from global RNG after setup).
