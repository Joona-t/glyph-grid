/* glyph-zones.js — zone-variable CONFIG dispatch.
 *
 * Scene contract v2 (IM-4): scenes return { zones?: p5.Graphics } where
 * the R channel encodes a zone ID in [0, 255]. Different zones can have
 * different glyph sets, palettes, selection modes, etc.
 *
 * API:
 *   GlyphGrid.zones.sampleCell(zoneImg, cellX, cellY, cellW, cellH)
 *     -> { primary: int, secondary: int, mix: float }
 *
 *   GlyphGrid.zones.resolveConfig(baseConfig, zoneConfigs, zoneId)
 *     -> merged CONFIG for that zone (zone wins over base)
 *
 *   GlyphGrid.zones.blendAtBoundary(outA, outB, mix)
 *     -> blended glyph cp or color (mix ∈ [0,1], 0=A, 1=B)
 *
 * Zone IDs are bilinear-interpolated across cell corners (EC-7), producing
 * a fractional zone value. We pick the two nearest integer zone IDs and
 * let the caller render both then blend by `mix`.
 *
 * If no zones buffer is provided, `sampleCell` returns { primary: 0, mix: 0 }
 * so the caller falls through to the base config.
 */

(function () {
  'use strict';

  /* Read the R channel at (x, y) of an ImageData-like object. */
  function readR(data, w, h, x, y) {
    if (x < 0) x = 0; else if (x >= w) x = w - 1;
    if (y < 0) y = 0; else if (y >= h) y = h - 1;
    const idx = (y * w + x) * 4;
    return data[idx];
  }

  /* Sample a cell's zone. The "dominant" (primary) zone ID is the one with
     max coverage within the cell; the "secondary" is the second-most. Mix
     is the fraction of the cell covered by secondary. */
  function sampleCell(zoneData, zoneW, zoneH, cellX, cellY, cellW, cellH) {
    const counts = Object.create(null);
    const x0 = cellX * cellW;
    const y0 = cellY * cellH;
    /* Sample at 4 quadrant centers for O(4) cost per cell, instead of the
       O(cellW*cellH) full enumeration. At 2-3 px cells this is fine. */
    const samplePoints = [
      [x0 + cellW * 0.25, y0 + cellH * 0.25],
      [x0 + cellW * 0.75, y0 + cellH * 0.25],
      [x0 + cellW * 0.25, y0 + cellH * 0.75],
      [x0 + cellW * 0.75, y0 + cellH * 0.75],
    ];
    for (let i = 0; i < samplePoints.length; i++) {
      const sx = samplePoints[i][0] | 0;
      const sy = samplePoints[i][1] | 0;
      const id = readR(zoneData, zoneW, zoneH, sx, sy);
      counts[id] = (counts[id] || 0) + 1;
    }
    let primary = 0, primaryN = 0, secondary = 0, secondaryN = 0;
    for (const id in counts) {
      const n = counts[id];
      if (n > primaryN) {
        secondary = primary; secondaryN = primaryN;
        primary = id | 0; primaryN = n;
      } else if (n > secondaryN) {
        secondary = id | 0; secondaryN = n;
      }
    }
    const total = samplePoints.length;
    return {
      primary: primary,
      secondary: secondary,
      mix: secondaryN / total,
    };
  }

  /* Merge zoneConfig (for a specific zone ID) atop baseConfig. Deep-merge
     one level; objects at depth 2 are replaced wholesale. Caller's
     responsibility to not mutate either input. */
  function resolveConfig(baseConfig, zoneConfigs, zoneId) {
    if (!zoneConfigs || !(zoneId in zoneConfigs)) return baseConfig;
    const zc = zoneConfigs[zoneId];
    const out = Object.assign({}, baseConfig);
    for (const k in zc) out[k] = zc[k];
    return out;
  }

  /* Given two outputs (glyph grids or color grids) and a per-cell mix
     factor, blend. For codepoints: pick A if mix < 0.5, else B.
     For RGB tuples: linear blend in linear-sRGB space (caller ensures
     inputs are linear). */
  function blendCp(cpA, cpB, mix) {
    return mix < 0.5 ? cpA : cpB;
  }

  function blendRgb(a, b, mix) {
    const t = mix;
    return [
      a[0] * (1 - t) + b[0] * t,
      a[1] * (1 - t) + b[1] * t,
      a[2] * (1 - t) + b[2] * t,
    ];
  }

  const api = Object.freeze({
    sampleCell: sampleCell,
    resolveConfig: resolveConfig,
    blendCp: blendCp,
    blendRgb: blendRgb,
  });

  const root = (typeof window !== 'undefined') ? window
             : (typeof globalThis !== 'undefined') ? globalThis
             : this;
  root.GlyphGrid = root.GlyphGrid || {};
  root.GlyphGrid.zones = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
