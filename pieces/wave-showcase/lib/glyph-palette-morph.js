/* glyph-palette-morph.js — interpolate between palettes over time.
 *
 * A palette is an ordered array of sRGB color strings (hex) OR [r,g,b] tuples
 * in [0,255]. Morph interpolates rank-paired entries in OKLab space so the
 * transitions stay perceptually smooth (linear sRGB blending produces
 * muddy midpoints).
 *
 * Palettes of different length: rank-pad the shorter by repeating the last
 * ink (EC-8). Blend factor `t` in [0, 1]: 0 = A only, 1 = B only. A cyclic
 * schedule for recording loops is caller-owned (see references/pipeline.md).
 *
 * API:
 *   const A = GlyphGrid.paletteMorph.parse(['#ff00aa', '#222', ...]);
 *   const cur = GlyphGrid.paletteMorph.blend(A, B, t); // returns parsed pal
 *   const css = GlyphGrid.paletteMorph.toHex(cur[i]);  // returns '#rrggbb'
 *
 * Internally all palette colors are stored as { srgb: [r,g,b], oklab: [L,a,b] }.
 */

(function () {
  'use strict';

  /* ---------- sRGB ↔ linear ↔ OKLab ---------- */

  function parseHex(h) {
    const s = h.replace(/^#/, '');
    const full = s.length === 3
      ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
      : s;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }

  function hex2(n) {
    const s = (n | 0).toString(16);
    return s.length < 2 ? '0' + s : s;
  }

  function toHex(rgb) {
    return '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]);
  }

  function srgbToLinear(c) {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    const clamped = Math.max(0, Math.min(1, v));
    return Math.round(clamped * 255);
  }

  /* Björn Ottosson's OKLab — designed for hue-preserving interpolation. */
  function linearToOklab(r, g, b) {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    return [
      0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    ];
  }

  function oklabToLinear(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    return [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
  }

  /* ---------- parse + blend ---------- */

  function parseEntry(e) {
    const rgb = typeof e === 'string' ? parseHex(e) : e;
    const [lr, lg, lb] = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
    const oklab = linearToOklab(lr, lg, lb);
    return { srgb: rgb, linear: [lr, lg, lb], oklab: oklab };
  }

  function parse(palette) {
    return palette.map(parseEntry);
  }

  function blend(A, B, t) {
    const n = Math.max(A.length, B.length);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = A[i < A.length ? i : A.length - 1];
      const b = B[i < B.length ? i : B.length - 1];
      const L = a.oklab[0] * (1 - t) + b.oklab[0] * t;
      const aa = a.oklab[1] * (1 - t) + b.oklab[1] * t;
      const bb = a.oklab[2] * (1 - t) + b.oklab[2] * t;
      const [lr, lg, lb] = oklabToLinear(L, aa, bb);
      const srgb = [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
      out[i] = { srgb: srgb, linear: [lr, lg, lb], oklab: [L, aa, bb] };
    }
    return out;
  }

  /* Piecewise-linear OKLab interpolation across N ordered stops.
     `stops` is the return of parse([...]). `u` ∈ [0,1], clamped.
     Returns an sRGB triple [r,g,b] in [0,255].  Intended for the v2.1
     gradient colorMode: one call per cell to map luminance (or depth)
     to a smooth perceptual color gradient. */
  function interpAtU(stops, u) {
    const n = stops.length;
    if (n === 0) return [0, 0, 0];
    if (n === 1) return [stops[0].srgb[0], stops[0].srgb[1], stops[0].srgb[2]];
    const uc = u <= 0 ? 0 : (u >= 1 ? 1 : u);
    const scaled = uc * (n - 1);
    const i = Math.min(n - 2, Math.floor(scaled));
    const t = scaled - i;
    const a = stops[i], b = stops[i + 1];
    const L  = a.oklab[0] * (1 - t) + b.oklab[0] * t;
    const aa = a.oklab[1] * (1 - t) + b.oklab[1] * t;
    const bb = a.oklab[2] * (1 - t) + b.oklab[2] * t;
    const [lr, lg, lb] = oklabToLinear(L, aa, bb);
    return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
  }

  /* Cyclic schedule — takes an ordered array of palettes [P0, P1, ...Pn]
     and a phase ∈ [0, 1]. Returns a blend between the two adjacent
     palettes on the loop, continuous at the seam. */
  function cyclicBlend(palettes, phase) {
    const n = palettes.length;
    if (n === 1) return palettes[0];
    const p = ((phase % 1) + 1) % 1;
    const scaled = p * n;
    const i = Math.floor(scaled) % n;
    const t = scaled - Math.floor(scaled);
    return blend(palettes[i], palettes[(i + 1) % n], t);
  }

  const api = Object.freeze({
    parse: parse,
    parseEntry: parseEntry,
    blend: blend,
    cyclicBlend: cyclicBlend,
    interpAtU: interpAtU,
    toHex: toHex,
    srgbToLinear: srgbToLinear,
    linearToSrgb: linearToSrgb,
    linearToOklab: linearToOklab,
    oklabToLinear: oklabToLinear,
  });

  const root = (typeof window !== 'undefined') ? window
             : (typeof globalThis !== 'undefined') ? globalThis
             : this;
  root.GlyphGrid = root.GlyphGrid || {};
  root.GlyphGrid.paletteMorph = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
