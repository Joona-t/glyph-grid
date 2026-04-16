# zones.md — zone-variable CONFIG via scene-contract v2

## Concept

A scene can return a second p5.Graphics buffer where the R channel encodes a zone ID per pixel. Cells inside each zone use a zone-specific CONFIG, stacked on top of the base CONFIG. Different zones can use different glyph sets, palettes, selection modes, etc. — all in one frame.

## Scene contract (v2)

```js
function mySplitScene(g, t, config) {
  // Paint into the src buffer as normal.
  g.background(bgColor(config));
  /* ... */

  // Build the zone buffer.
  const z = createGraphics(g.width, g.height);
  z.pixelDensity(1);
  z.noStroke();
  z.fill(1, 1, 1); z.rect(0, 0, g.width / 2, g.height);
  z.fill(2, 2, 2); z.rect(g.width / 2, 0, g.width / 2, g.height);

  return { zones: z };
}
```

If `zones` is returned, the runtime binds it for the frame. If not returned (v1 contract), the pipeline ignores zones and uses the base config.

## Zone CONFIG

```js
CONFIG.zones = {
  enabled: true,
  /* zone ID -> partial CONFIG override */
  1: { glyphSet: 'braille', selectionMode: 'shape', palette: 'lovespark' },
  2: { glyphSet: 'octant',  selectionMode: 'shape', palette: 'phosphor' },
};
```

Zone 0 is the implicit default (receives base CONFIG). IDs 1–255 are user-defined; IDs above 255 are unreachable because the R channel is 8-bit.

## Sampling per cell

Per cell, `glyph-zones.sampleCell(zoneData, zoneW, zoneH, cellX, cellY, cellW, cellH)` returns:

```
{ primary: int, secondary: int, mix: float ∈ [0, 1] }
```

- `primary`: zone ID with most coverage in the cell.
- `secondary`: second-most zone ID.
- `mix`: fraction of cell covered by `secondary`.

If `mix < 0.2`, the cell is considered "fully primary" — draw once using zone[primary]'s CONFIG.

If `mix ≥ 0.2`, the cell is at a zone boundary — draw twice (once with primary config, once with secondary) and blend via `mix`. Use `glyph-zones.blendCp(cpA, cpB, mix)` for codepoints or `blendRgb(a, b, mix)` for colors.

## Boundary behavior (EC-7)

Hard boundaries (mix = 0 or 1) are the simple case. Soft boundaries:

- **Codepoints**: `blendCp` is a hard pick (A if mix < 0.5, else B). You can't interpolate a codepoint; either the cell is one glyph or another.
- **Colors**: `blendRgb` does linear blend in linear-sRGB space. Caller must ensure inputs are in the same space.

To soften boundaries visually, shrink cellSize near the zone boundary — smaller cells mean the transition happens across more cells, which reads as a gradient rather than a cut.

## Determinism

Deterministic because:

- The zones buffer comes from the scene function, which is a pure function of t.
- `sampleCell` is deterministic.
- The config merge is deterministic.

If you want *animated* zones (zones that move over time), make them a function of t inside the scene. Don't introduce per-frame state.

## Performance

Each cell now does two samples (one scene, one zones) and potentially two glyph draws (primary + secondary blend). At 100×100 that's still ~1 ms at 800² canvas, but scales with cell count.

## Layered scenes (T4.2, deferred)

A future v3 could layer multiple scenes (foreground + background) with per-layer configs. Zones approximate that today: the scene has to merge the layers into src itself, but the zone-variable pipeline handles differential rendering.

## Example: caduceus with zone-variant rendering

```js
CONFIG.scene = 'caduceusHelix';
CONFIG.zones = {
  enabled: true,
  1: { selectionMode: 'shape',          palette: 'lovespark' }, /* main canvas */
  2: { selectionMode: 'edge-directional', palette: 'phosphor' }, /* wing band */
};

// scene (inside SCENES):
caduceusHelix(g, t, config) {
  /* ... normal draw ... */

  // Zone buffer: band gets zone 2, rest gets zone 1.
  const z = createGraphics(g.width, g.height);
  z.pixelDensity(1);
  z.noStroke();
  z.fill(1, 1, 1); z.rect(0, 0, g.width, g.height);
  z.fill(2, 2, 2); z.rect(bandLeft, bandTop, bandRight - bandLeft, bandBot - bandTop);
  return { zones: z };
}
```

Result: the caduceus body renders with shape-vector selection on the pink palette; the wing band renders with edge-directional selection on the green palette. One frame, one render.
