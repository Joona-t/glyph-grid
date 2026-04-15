# Scene patterns — annotated walkthroughs

Four scenes ship with `scripts/render.html`. Each one is a template for a class of generative technique. When scaffolding a new piece, either switch `CONFIG.scene` to one of these or copy one as a starting point for a custom scene.

All four respect the locked contract:

```
scene(g: p5.Graphics, t: number, config: CONFIG) => void
```

They pull colors via `inkColor(config, i)` (which wraps palette inks modulo their count) and background via `bgColor(config)`, so they work on every palette without modification.

---

## Pattern 1: parametric curves over time

**Exemplar:** `caduceusHelix` — the Phase 1 reference scene.

**The shape:**
- A static vertical staff (one `g.line()`).
- Two helices in counter-phase, drawn as polylines with `g.beginShape()` / `g.vertex()` / `g.endShape()`. The angle argument includes `t * speed` so both helices rotate around the staff.
- A wing-band of short horizontal dashes whose density and vertical offset are driven by 3-axis Perlin noise `g.noise(i, t)` — the third axis is time, so the cloud pattern evolves without any per-frame state.

**What makes this pattern work:**
- **Polylines, not splines.** Using `curveVertex` for smooth curves introduces Catmull-Rom edge artifacts at the loop boundary. A polyline with 320 samples is smooth enough that the glyph grid can't tell the difference, and the loop is seamless.
- **Speed derived from `config.animation.duration`.** One full rotation per loop: `speed = (2π) / duration`. Scenes never hardcode "rotate at X rad/s" — they express "complete N cycles per loop", so any duration change produces a seamless loop at the new length.
- **Noise time-axis for cloud textures.** `g.noise(i * 0.13, t * 0.5)` sweeps through a 2D slice of a 3D Perlin field. The pattern is coherent frame-to-frame (not random) and periodic-ish over long `t`. Good enough for "looping cloud texture" as long as the duration is short.

**Adapt this pattern for:** ribbons, spiraling particles, any geometry that's "a curve parameterized by `u ∈ [0,1]` with `t`-dependent phase."

---

## Pattern 2: Perlin vector-field integration

**Exemplar:** `flowField`.

**The shape:**
- 220 deterministic "streamlines", each seeded at a jittered grid position.
- Each streamline integrates forward 60 steps through a Perlin vector field: sample `g.noise(x * scale, y * scale, t * drift)` at the current position, interpret it as an angle, step `stepSize` pixels in that direction, repeat. Draw the full path as a polyline.

**What makes this pattern work:**
- **No per-frame particle state.** This is the single most important rule. A naive flow field stores "current x/y" for each particle and advances them per frame. That's stateful — recording breaks, loops don't close, determinism vanishes. Instead, the seed positions are a deterministic function of the loop index (`i * 73 % 13`, etc.), and the field evolves via `t`, so the full frame is reproducible from just `t`.
- **Time-drift on the noise field.** `tDrift = t * 0.15` moves the Perlin sampling through the 3rd axis. That *breathes* the field — streamlines slowly curve to new orientations — without any particle memory. Rate `0.15` is tuned: higher feels chaotic, lower feels static.
- **`angle = noise * π * 4`**, not `* π * 2`. That multiplier controls the curl. `* 2π` gives gently swirling streamlines. `* 4π` gives enough curl to be visually interesting without breaking into full chaos. Tunable parameter — most of a flow field's character lives here.
- **Deterministic jittered seeds.** The seed positions use prime moduli (`73`, `31`, `17`, `11`, `13`) so the grid looks uniform without being a visible grid. Pure grid gives aliasing. Pure random gives clumps. The prime-modulo approach is "deterministic pseudo-random" and gives the right visual distribution.

**Adapt this pattern for:** any "flowing particles" effect. Replace the noise angle with other vector fields (gradient of a potential, curl of another field, polar rotation, etc.) and you get different flows. The deterministic-seed + t-drift structure is the reusable bit.

---

## Pattern 3: radial polyline fields

**Exemplar:** `concentricRings`.

**The shape:**
- 28 concentric rings, each drawn as a 220-segment polyline.
- Each ring's radius wobbles sinusoidally: `radius = baseR + sin(a * waveFreq + phase) * waveAmp`. `waveFreq` varies per ring (`4 + (r % 5)` — distinct shape per ring). `phase` advances with `t`.

**What makes this pattern work:**
- **Rings draw as polylines, not `ellipse()`.** `ellipse()` would be two calls (for the wobbled radius you'd need custom polyline anyway). Drawing manually also lets the wobble be explicit.
- **Amp proportional to radius.** `waveAmp = baseR * 0.06` — outer rings wobble more in absolute terms, less in relative terms. This keeps the visual texture consistent across the radius.
- **Per-ring frequency variation.** Every ring gets a slightly different `waveFreq` (`4 + r % 5`), so the composite has visible beats between adjacent rings. If all rings had the same frequency, the output would be a static radial pattern with uniform wobble — boring.
- **Phase uses `r * 0.21`.** That's a small per-ring offset so adjacent rings' waves are slightly out of phase, preventing the whole field from pulsing in sync.

**Adapt this pattern for:** mandala-style outputs, audio-reactive circular visualizers, any "concentric shapes that breathe" effect. Replace the wobble with a different radial modulation (e.g., `sin(t + r)` for pure pulse, or noise-driven radii for organic variation).

---

## Pattern 4: image asset + animated overlay

**Exemplar:** `sparkyPortrait`.

**The shape:**
- Preloaded PNG (`sparkyImg`, loaded via the top-level `preload()` function) drawn centered on the buffer with a gentle sine-wave bob.
- Behind it: 60 deterministic sparkle glyphs drifting upward, wrapped to the canvas height, with per-sparkle twinkle offsets.
- Also behind it: 14 magenta heart particles orbiting in slow ellipses.
- If the image failed to load, falls back to a procedural pink circle + cyan ring so the renderer always shows *something*.

**What makes this pattern work:**
- **Preload is top-level, not inside the scene.** p5 auto-detects the global `preload()` function and blocks `setup()` until the image is loaded. The scene function stays synchronous — it just references `sparkyImg` from module scope. This is the only way to use external assets without breaking the scene contract.
- **Graceful fallback on load failure.** `loadImage('path', ok, err)` with the error callback nulling out `sparkyImg`. The scene checks `if (sparkyImg && sparkyImg.width > 0)` and draws a placeholder otherwise. Never assume the asset loaded.
- **All animation is `t`-derived, even for the sparkles.** No per-frame state. Each sparkle's seed (`i * 97 + 13`) determines its baseX/baseY deterministically; its twinkle phase is `sin(loopPhase * 3 + i * 0.7)`. Record mode works.
- **`imageMode(g.CENTER)` then `imageMode(g.CORNER)` at the end.** Setting imageMode leaks across scenes if not reset. Always restore it at the end of the scene.
- **Particles are low-alpha on purpose.** Sparkles at 60–255 alpha, hearts at 110 alpha. The glyph grid only renders cells whose signal exceeds `0.02`, so low-alpha particles become faint/blinking glyphs rather than solid shapes. That's the visual effect you want for a background field.
- **Image asset becomes ASCII via the normal pipeline.** No special handling in the grid pass — the PNG pixels go into the buffer, `loadPixels()` reads them, `average` sampling + `preserve` color mode gives you Sparky as colored ASCII. The asset is just another source of pixels.

**Adapt this pattern for:** logo portraits (swap `sparkyImg` for any other PNG), photo-based glyph art (higher grid density works better for detailed photos — try 140×140 at font size 6), or any "character + background field" composition.

---

## Writing a new scene

Minimum viable scene:

```js
myScene(g, t, config) {
  const W = g.width, H = g.height;
  g.background(bgColor(config));

  // Derive a rotation/phase from t that completes an integer number
  // of cycles per loop. This is what makes the loop seamless.
  const loopPhase = (t / config.animation.duration) * Math.PI * 2;

  // Draw something that depends on loopPhase, using inkColor for all colors.
  g.stroke(inkColor(config, 0));
  g.strokeWeight(2);
  g.noFill();
  g.beginShape();
  for (let i = 0; i < 400; i++) {
    const u = i / 400;
    const angle = u * Math.PI * 10 + loopPhase;
    const r = 200 + Math.sin(u * Math.PI * 6 + loopPhase) * 40;
    g.vertex(W/2 + Math.cos(angle) * r, H/2 + Math.sin(angle) * r);
  }
  g.endShape();
},
```

Register it in the `SCENES` object, set `CONFIG.scene = 'myScene'`, reload. No other plumbing required.

**Common mistakes:**

1. Using global `noise()`/`random()` instead of `g.noise()`/`g.random()`. The offscreen graphics has its own seeded state — you must call it on `g`.
2. Using `ellipse()` without realizing it's affected by `ellipseMode()`. Same for `image()`/`imageMode()`, `rect()`/`rectMode()`. Always reset modes at the end of your scene, or set them explicitly at the top.
3. Storing state in closures — `let counter = 0; scene() { counter++; ... }`. Wrong. Any state breaks record mode. Use `t` instead.
4. Forgetting `g.background()` at the top of the scene. Without it, previous frames bleed through.
5. Hardcoding colors. Use `inkColor(config, 0)`, `inkColor(config, 1)`, etc. — the scene should look "correct" on every palette.
