# Pattern 5: image-composite with zone masking

**Exemplar:** `eyeOfRa` scene in `~/projects/glyph-art/eye-of-ra-spice/index.html`. First production use of this pattern.

**When to use:**
- The request is for a piece based on a specific iconographic reference (Eye of Horus/Ra, ankh, rune, logo, sigil, mascot) where the exact shape matters.
- You've tried or are tempted to redraw the reference in parametric p5 geometry and it keeps "not quite matching" — the user says things like "the curl is too circular" or "the proportions are off" or "look at where everything is."
- The reference image is a clean silhouette (line art, flat graphic) where zone boundaries are well-defined.

**When NOT to use:**
- The reference is a photograph or complex gradient — zone-masking in RGB fails when the input has smooth shading. Use Pattern 4 (image + overlay) instead, which samples the raw pixels without preprocessing.
- The user wants a generative piece with no specific reference — stick to Patterns 1–3 (parametric geometry).

## The shape

Three-stage composition:

1. **`preload()` preprocesses the reference PNG into a zoned palette.** Instead of drawing the reference verbatim, walk the pixel buffer once at load time and recolor each pixel based on its *position* relative to known reference landmarks (iris center, eye corner, etc.), and its *luminance* (for alpha). The image that lands in `wedjatImg` is already colored in your target palette — no runtime color mapping needed.

2. **The scene function composites the image** over a rotating glow aura and under a sparkle overlay. The preprocessed image is drawn with `g.image(img, x, y, w, h)` at a position derived from the reference's aspect ratio and the canvas size.

3. **Sparkle overlays read back the preprocessed image's pixels** to decide where each sparkle lands. You can distinguish pupil/iris/outline zones by checking the color channels of the underlying pixel (e.g. blue > 170 means iris; blue < 170 and alpha > 120 means outline).

## Why this works when parametric geometry fails

LLMs can't visually diff their output against a reference image. Every iteration on parametric curves requires the user to be the eyes. With image-composite:

- **Shape correctness is guaranteed** — the shape IS the reference, just re-quantized through the glyph-grid sampler.
- **Color choices are local** — you pick the palette for each zone in `preload()` and it stays correct no matter how the scene animates.
- **Animation layers cleanly on top** — you can still add rotating glow rings, twinkling sparkles, and pulse effects as dynamic overlays.

The trade-off: the piece is specific to one reference shape. It's not a generative scene you can run with different seeds. For that, use Patterns 1–3.

## Minimal reference implementation

```javascript
// ===== preload (outside SCENES) =====
let wedjatImg = null;

function preload() {
  wedjatImg = loadImage(
    'assets/eye-of-ra.png',
    () => {
      // Preprocess: recolor each pixel based on position + luminance.
      wedjatImg.loadPixels();
      const px = wedjatImg.pixels;
      const W  = wedjatImg.width;
      // Reference landmarks (measured once, hardcoded):
      const IRIS_CX = 335, IRIS_CY = 166;
      const IRIS_R  = 33, PUPIL_R = 12;
      const IRIS_R2 = IRIS_R * IRIS_R, PUPIL_R2 = PUPIL_R * PUPIL_R;
      for (let i = 0; i < px.length; i += 4) {
        const idx = i >> 2;
        const x = idx % W;
        const y = (idx / W) | 0;
        const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
        const darkness = 1 - lum / 255;       // 1 for black ink, 0 for white
        const dx = x - IRIS_CX, dy = y - IRIS_CY;
        const dist2 = dx * dx + dy * dy;
        // Three concentric color zones:
        if (dist2 < PUPIL_R2) {
          px[i] = 192; px[i+1] = 240; px[i+2] = 255; // ethereal pupil
        } else if (dist2 < IRIS_R2) {
          px[i] = 74;  px[i+1] = 144; px[i+2] = 226; // iris ring
        } else {
          px[i] = 255; px[i+1] = 210; px[i+2] = 122; // gold outline
        }
        // Alpha = luminance-driven: opaque where ink was, transparent
        // where white background was.
        px[i + 3] = Math.round(255 * darkness * (px[i + 3] / 255));
      }
      wedjatImg.updatePixels();
    },
    () => { wedjatImg = null; }   // fallback if load fails
  );
}

// ===== scene (inside SCENES) =====
myImageComposite(g, t, config) {
  const W = g.width, H = g.height;
  g.background(bgColor(config));
  const loopSpeed = (Math.PI * 2) / config.animation.duration;
  const pulse = 0.7 + Math.sin(t * loopSpeed) * 0.3;

  // --- Image layout + derived landmark positions in canvas coords ----
  // Ratios come from the REFERENCE image, not eyeballed.
  const REF_W = 500, REF_H = 385;
  const IRIS_U = 0.67, IRIS_V = 0.431;  // iris center as fraction of image
  const imgW = W * 0.90;
  const imgH = imgW * (REF_H / REF_W);
  const imgX = (W - imgW) / 2;
  const imgY = (H - imgH) / 2;
  const irisX = imgX + imgW * IRIS_U;
  const irisY = imgY + imgH * IRIS_V;
  const irisR = imgH * (33 / REF_H);  // iris radius scaled from reference

  // --- Layer 1: background atmosphere (unchanged from earlier patterns) --
  // ... sparse twinkling dots in canvas margins, excluding the aura zone ...

  // --- Layer 2: rotating glow aura (centered on the iris position) ------
  // ... dashed arc rings, each with integer cycles-per-loop rotation ...

  // --- Layer 3: inner glow rings (inside the iris circle) --------------
  // ... similar to layer 2 but smaller radii and counter-rotating ...

  // --- Layer 4: the preprocessed image itself --------------------------
  if (wedjatImg && wedjatImg.width > 0) {
    g.imageMode(g.CORNER);
    g.image(wedjatImg, imgX, imgY, imgW, imgH);
  }

  // --- Layer 5: sparkle overlay (reads back wedjatImg.pixels) ----------
  // For each deterministic sparkle, sample the underlying image pixel to
  // filter by zone. The blue channel distinguishes cyan iris (226) from
  // gold outline (122), so thresholding at 170 separates the two.
  if (wedjatImg) {
    const refPx = wedjatImg.pixels;
    const refW = wedjatImg.width, refH = wedjatImg.height;
    // (a) outline stardust — on gold pixels
    for (let i = 0; i < 90; i++) {
      const seed = i * 211 + 11;
      const sx = imgX + ((seed * 37) % 10007) / 10007 * imgW;
      const sy = imgY + ((seed * 71) % 10007) / 10007 * imgH;
      const rx = Math.floor((sx - imgX) / imgW * refW);
      const ry = Math.floor((sy - imgY) / imgH * refH);
      const pi = (ry * refW + rx) * 4;
      if (refPx[pi + 3] < 120) continue;    // skip transparent
      if (refPx[pi + 2] > 170) continue;    // skip iris (blue>170)
      const tw = (Math.sin(t * loopSpeed * 2.5 + i * 0.47) + 1) / 2;
      g.noStroke();
      g.fill(255, 245, 200, 120 + tw * 135);
      g.ellipse(sx, sy, 2 + tw * 3.5, 2 + tw * 3.5);
    }
    // (b) iris ring sparkles — inside the iris annulus
    // (c) pupil core sparkles — inside the inner pupil, faster twinkle
    // ... (see the eyeOfRa scene for the full implementation) ...
  }
}
```

## Things that go wrong (and fixes)

1. **Image darkens at zone boundaries** — if the preprocessed alpha is driven by luminance and the reference has anti-aliased edges, pixels right at the zone boundary end up slightly faded. Fix: use a small dilation (check neighboring pixels) or accept it as texture.

2. **Preprocessing runs before `setup()` completes** — `loadImage` is async. If you call `.loadPixels()` inside the success callback and the scene tries to read `wedjatImg.pixels` before that callback fires, you get undefined behavior. Gate the scene code with `if (wedjatImg && wedjatImg.width > 0)` and provide a fallback (a circle or solid block in the iris area) so the first few frames still render.

3. **Sparkle layer reads stale pixels** — once `updatePixels()` is called, the pixels array is still accessible in memory but `drawImage` uses the texture. Both show the same data, so this is fine. If you re-preprocess mid-scene (you shouldn't), call `loadPixels()` again.

4. **Landmark positions drift when the image is rescaled** — if you change `imgW` without updating the iris-center ratios, the glow rings center in the wrong place. Keep the landmark ratios (`IRIS_U`, `IRIS_V`) locked to the reference image's aspect and derive canvas positions from `imgX/imgY/imgW/imgH`.

5. **Edge-weighted sampling on thin preprocessed strokes loses color** — the same bug that bit parametric scenes: if the ink stroke is thinner than a glyph cell, the center-pixel color sample reads as bg. Fix: either bump the stroke in the reference (dilate in preprocessing), or switch `samplingStrategy` to `'average'` where the cell-mean color comes through.

## Hard rules (image-composite specific)

- **Measure the reference once, hardcode the landmarks.** Don't try to auto-detect iris centers at render time — fragile and slow. Do the measurement offline with Python/PIL (see PLAN.md for a worked example) and paste the numbers as constants.

- **Keep the preprocessed image in memory for the whole session.** Don't re-preprocess on every frame or every loop. The pixel buffer is a few hundred KB; leave it resident.

- **Use zone-masking for icons, raw sampling for photos.** The preprocessing in this pattern is designed for flat, clean silhouettes where zone boundaries are well-defined. A photograph's gradient colors don't map cleanly to discrete zones.

- **Document the landmarks.** Every hardcoded constant like `IRIS_CX = 335` deserves a comment pointing at the reference image and the measurement method. Future-you (or the next LLM) needs to know where the numbers came from.

## Variant axes

Once you have a zone-masked image-composite piece, a lot of variations are free:

- **Palette swap** — change the three zone colors in `preload()` to target a different aesthetic (phosphor green / bauhaus primaries / monochrome).
- **Zone count** — two zones (inside/outside), three (pupil/iris/outline as above), five (add highlight and shadow bands). More zones = more color drama.
- **Animated zone boundaries** — make `IRIS_R` pulse with `sin(t)` so the boundary between zones breathes. Slightly surreal, works for "awakening eye" effects.
- **Multi-reference** — load two PNGs, zone-mask both, composite one inside the other (a smaller sigil inside the iris of a larger eye, etc).
- **Orientation mirror** — flip the reference image horizontally for the mirror symbol (e.g. Eye of Horus from Eye of Ra reference).

See the eye-of-ra-spice piece for the full working example.
