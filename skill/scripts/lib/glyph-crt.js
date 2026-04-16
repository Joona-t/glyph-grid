/* glyph-crt.js — CRT post-process chain (CPU path).
 *
 * Ordered chain applied AFTER glyph draw, BEFORE record:
 *
 *   1. phosphor decay — blend previous frame by decayFactor (stateful)
 *   2. halation       — extract bright threshold, blur, add
 *   3. bloom          — same but broader, additive
 *   4. scanlines      — multiplicative darken of alternating rows
 *   5. chromatic aberration — clamped per-channel x offset (CR-9)
 *   6. barrel distortion  — light radial warp (sample with bilerp)
 *   7. vignette       — radial darken at edges
 *
 * Each stage honors its own CONFIG.postprocess.<stage>.enabled switch.
 *
 * State (phosphor decay) is stored in a persistent Float32 RGB buffer. The
 * caller must warm up N frames before recording (CR-8) — this lib exposes
 * prerollFrames(n, canvas) that runs N phosphor-decay iterations without
 * committing to the screen.
 *
 * Reduced motion: when opts.prefersReducedMotion is true, animated stages
 * (scanline subpixel shift, phosphor decay, chromatic wobble) become static.
 *
 * All stages take and return ImageData (8-bit RGBA). Internal math uses
 * linear-light where needed (halation/bloom blur; linear in linear out).
 */

(function () {
  'use strict';

  function srgbToLinear(c) {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  }

  function makeState(w, h) {
    return {
      width: w,
      height: h,
      phosphor: new Float32Array(w * h * 3),  /* linear RGB */
      phosphorInit: false,
    };
  }

  /* --- 1. Phosphor decay --- */

  function applyPhosphorDecay(rgba, state, opts) {
    const decayFactor = opts.decayFactor == null ? 0.85 : opts.decayFactor;
    const N = rgba.length / 4;
    if (!state.phosphorInit) {
      for (let i = 0; i < N; i++) {
        state.phosphor[i * 3]     = srgbToLinear(rgba[i * 4]);
        state.phosphor[i * 3 + 1] = srgbToLinear(rgba[i * 4 + 1]);
        state.phosphor[i * 3 + 2] = srgbToLinear(rgba[i * 4 + 2]);
      }
      state.phosphorInit = true;
      return rgba;
    }
    for (let i = 0; i < N; i++) {
      const oldR = state.phosphor[i * 3];
      const oldG = state.phosphor[i * 3 + 1];
      const oldB = state.phosphor[i * 3 + 2];
      const newR = srgbToLinear(rgba[i * 4]);
      const newG = srgbToLinear(rgba[i * 4 + 1]);
      const newB = srgbToLinear(rgba[i * 4 + 2]);
      /* Max blend preserves bright trails without darkening live content. */
      const blendR = Math.max(newR, oldR * decayFactor);
      const blendG = Math.max(newG, oldG * decayFactor);
      const blendB = Math.max(newB, oldB * decayFactor);
      state.phosphor[i * 3]     = blendR;
      state.phosphor[i * 3 + 1] = blendG;
      state.phosphor[i * 3 + 2] = blendB;
      rgba[i * 4]     = linearToSrgb(blendR);
      rgba[i * 4 + 1] = linearToSrgb(blendG);
      rgba[i * 4 + 2] = linearToSrgb(blendB);
    }
    return rgba;
  }

  /* --- Small box blur for bloom/halation (linear-light, separable). --- */

  function boxBlurLinear(src, w, h, radius) {
    const out = new Float32Array(src.length);
    const tmp = new Float32Array(src.length);
    const window = radius * 2 + 1;
    /* Horizontal */
    for (let y = 0; y < h; y++) {
      const row = y * w * 3;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let i = -radius; i <= radius; i++) {
          const xx = Math.max(0, Math.min(w - 1, i));
          sum += src[row + xx * 3 + c];
        }
        tmp[row + 0 * 3 + c] = sum / window;
        for (let x = 1; x < w; x++) {
          const addX = Math.min(w - 1, x + radius);
          const subX = Math.max(0, x - radius - 1);
          sum += src[row + addX * 3 + c] - src[row + subX * 3 + c];
          tmp[row + x * 3 + c] = sum / window;
        }
      }
    }
    /* Vertical */
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let i = -radius; i <= radius; i++) {
          const yy = Math.max(0, Math.min(h - 1, i));
          sum += tmp[yy * w * 3 + x * 3 + c];
        }
        out[0 * w * 3 + x * 3 + c] = sum / window;
        for (let y = 1; y < h; y++) {
          const addY = Math.min(h - 1, y + radius);
          const subY = Math.max(0, y - radius - 1);
          sum += tmp[addY * w * 3 + x * 3 + c] - tmp[subY * w * 3 + x * 3 + c];
          out[y * w * 3 + x * 3 + c] = sum / window;
        }
      }
    }
    return out;
  }

  function applyBloom(rgba, w, h, opts) {
    const threshold = opts.threshold == null ? 0.75 : opts.threshold;
    const intensity = opts.intensity == null ? 0.5 : opts.intensity;
    const radius = opts.radius == null ? 6 : opts.radius;
    const N = rgba.length / 4;
    const lin = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      let r = srgbToLinear(rgba[i * 4]);
      let g = srgbToLinear(rgba[i * 4 + 1]);
      let b = srgbToLinear(rgba[i * 4 + 2]);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const over = Math.max(0, luma - threshold);
      const scale = over > 0 ? over / Math.max(luma, 1e-4) : 0;
      lin[i * 3]     = r * scale;
      lin[i * 3 + 1] = g * scale;
      lin[i * 3 + 2] = b * scale;
    }
    const blurred = boxBlurLinear(lin, w, h, radius | 0);
    for (let i = 0; i < N; i++) {
      const r = srgbToLinear(rgba[i * 4])     + blurred[i * 3]     * intensity;
      const g = srgbToLinear(rgba[i * 4 + 1]) + blurred[i * 3 + 1] * intensity;
      const b = srgbToLinear(rgba[i * 4 + 2]) + blurred[i * 3 + 2] * intensity;
      rgba[i * 4]     = linearToSrgb(r);
      rgba[i * 4 + 1] = linearToSrgb(g);
      rgba[i * 4 + 2] = linearToSrgb(b);
    }
    return rgba;
  }

  /* --- Scanlines --- */

  function applyScanlines(rgba, w, h, opts) {
    const intensity = opts.intensity == null ? 0.25 : opts.intensity;
    const period = Math.max(1, opts.period | 0 || 2);
    const phase = opts.phase || 0;
    for (let y = 0; y < h; y++) {
      const darken = ((y + phase) % period === 0) ? 1 : (1 - intensity);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        rgba[i]     = rgba[i]     * darken;
        rgba[i + 1] = rgba[i + 1] * darken;
        rgba[i + 2] = rgba[i + 2] * darken;
      }
    }
    return rgba;
  }

  /* --- Chromatic aberration --- */

  function applyChromaticAberration(rgba, w, h, opts) {
    const maxOffset = opts.offset == null ? 0.5 : opts.offset;
    /* CR-9: clamp to <= 0.5 * cellSize in the caller's opts; caller should
       compute `offset` based on cellSize; we just obey. */
    const src = new Uint8ClampedArray(rgba);
    const dx = Math.min(Math.max(-5, maxOffset), 5);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const iDst = (y * w + x) * 4;
        const xr = Math.max(0, Math.min(w - 1, Math.round(x - dx)));
        const xb = Math.max(0, Math.min(w - 1, Math.round(x + dx)));
        rgba[iDst]     = src[(y * w + xr) * 4];     /* R shifted left */
        rgba[iDst + 1] = src[(y * w + x) * 4 + 1];  /* G centered */
        rgba[iDst + 2] = src[(y * w + xb) * 4 + 2]; /* B shifted right */
      }
    }
    return rgba;
  }

  /* --- Barrel distortion --- */

  function applyBarrel(rgba, w, h, opts) {
    const strength = opts.strength == null ? 0.08 : opts.strength;
    const src = new Uint8ClampedArray(rgba);
    const cx = w / 2, cy = h / 2;
    const maxR2 = cx * cx + cy * cy;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ux = (x - cx);
        const uy = (y - cy);
        const r2 = (ux * ux + uy * uy) / maxR2;
        const f = 1 + strength * r2;
        const sx = cx + ux * f;
        const sy = cy + uy * f;
        /* Nearest-neighbor — fast, avoids ringing on glyph edges. */
        const ix = Math.max(0, Math.min(w - 1, sx | 0));
        const iy = Math.max(0, Math.min(h - 1, sy | 0));
        const iSrc = (iy * w + ix) * 4;
        const iDst = (y * w + x) * 4;
        rgba[iDst]     = src[iSrc];
        rgba[iDst + 1] = src[iSrc + 1];
        rgba[iDst + 2] = src[iSrc + 2];
      }
    }
    return rgba;
  }

  /* --- Vignette --- */

  function applyVignette(rgba, w, h, opts) {
    const strength = opts.strength == null ? 0.5 : opts.strength;
    const cx = w / 2, cy = h / 2;
    const maxR = Math.hypot(cx, cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = Math.hypot(x - cx, y - cy) / maxR;
        const darken = 1 - strength * r * r;
        const i = (y * w + x) * 4;
        rgba[i]     = rgba[i]     * darken;
        rgba[i + 1] = rgba[i + 1] * darken;
        rgba[i + 2] = rgba[i + 2] * darken;
      }
    }
    return rgba;
  }

  /* --- Apply chain --- */

  function applyChain(imgData, state, postOpts, runtime) {
    postOpts = postOpts || {};
    runtime = runtime || {};
    const w = imgData.width, h = imgData.height;
    const d = imgData.data;
    const reduced = !!runtime.prefersReducedMotion;

    if (postOpts.phosphorDecay && postOpts.phosphorDecay.enabled && !reduced) {
      applyPhosphorDecay(d, state, postOpts.phosphorDecay);
    }
    if (postOpts.halation && postOpts.halation.enabled) {
      applyBloom(d, w, h, Object.assign({ threshold: 0.6, intensity: 0.3, radius: 4 }, postOpts.halation));
    }
    if (postOpts.bloom && postOpts.bloom.enabled) {
      applyBloom(d, w, h, postOpts.bloom);
    }
    if (postOpts.scanlines && postOpts.scanlines.enabled) {
      const phase = reduced ? 0 : (postOpts.scanlines.phase || 0);
      applyScanlines(d, w, h, Object.assign({}, postOpts.scanlines, { phase: phase }));
    }
    if (postOpts.chromaticAberration && postOpts.chromaticAberration.enabled) {
      applyChromaticAberration(d, w, h, postOpts.chromaticAberration);
    }
    if (postOpts.barrel && postOpts.barrel.enabled) {
      applyBarrel(d, w, h, postOpts.barrel);
    }
    if (postOpts.vignette && postOpts.vignette.enabled) {
      applyVignette(d, w, h, postOpts.vignette);
    }
    return imgData;
  }

  /* Pre-roll: advance stateful stages N frames before recording (CR-8). */
  function prerollFrames(n, capture, state, postOpts, runtime) {
    for (let i = 0; i < n; i++) {
      const img = capture(i);
      if (!img) return;
      applyChain(img, state, postOpts, runtime);
    }
  }

  const api = Object.freeze({
    makeState: makeState,
    applyPhosphorDecay: applyPhosphorDecay,
    applyBloom: applyBloom,
    applyScanlines: applyScanlines,
    applyChromaticAberration: applyChromaticAberration,
    applyBarrel: applyBarrel,
    applyVignette: applyVignette,
    applyChain: applyChain,
    prerollFrames: prerollFrames,
    boxBlurLinear: boxBlurLinear,
  });

  const root = (typeof window !== 'undefined') ? window
             : (typeof globalThis !== 'undefined') ? globalThis
             : this;
  root.GlyphGrid = root.GlyphGrid || {};
  root.GlyphGrid.crt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
