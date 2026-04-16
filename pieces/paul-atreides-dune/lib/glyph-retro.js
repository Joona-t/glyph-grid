/* glyph-retro.js — retro-mode preset loader + merger (IM-8).
 *
 *   const modeCfg = GlyphGrid.retro.load(modeName, userConfig);
 *
 * Order of precedence (lowest -> highest):
 *   1. Skill defaults (baked into render.html)
 *   2. Retro-mode preset
 *   3. User CONFIG (wins over everything)
 *
 * Loader reads retro-mode-presets.json via fetch at setup. For the
 * monolithic file build we also allow pre-embedding the JSON via
 *   window.__GlyphGridRetroPresets = { ... }
 * to avoid the extra HTTP round-trip.
 */

(function () {
  'use strict';

  let CACHED_PRESETS = null;

  function loadPresets(urlOrInline) {
    if (CACHED_PRESETS) return Promise.resolve(CACHED_PRESETS);
    if (typeof window !== 'undefined' && window.__GlyphGridRetroPresets) {
      CACHED_PRESETS = window.__GlyphGridRetroPresets;
      return Promise.resolve(CACHED_PRESETS);
    }
    const url = urlOrInline || './retro-mode-presets.json';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('retro presets fetch failed: ' + r.status);
      return r.json();
    }).then(function (j) {
      CACHED_PRESETS = j;
      return j;
    });
  }

  /* Shallow merge one level deep. Objects at depth >=2 are replaced. */
  function mergeOne(base, over) {
    const out = Object.assign({}, base);
    for (const k in over) {
      if (k.startsWith('_')) continue;
      out[k] = over[k];
    }
    return out;
  }

  function resolve(modeName, userConfig, presets) {
    if (!modeName || modeName === 'none') return userConfig;
    const p = presets && presets[modeName];
    if (!p) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('glyph-retro: unknown mode "' + modeName + '"');
      }
      return userConfig;
    }
    /* Apply preset over empty, then user over that. User always wins. */
    const preset = mergeOne({}, p);
    return mergeOne(preset, userConfig || {});
  }

  /* Convenience: load presets then resolve. */
  function load(modeName, userConfig, urlOrInline) {
    return loadPresets(urlOrInline).then(function (presets) {
      return resolve(modeName, userConfig, presets);
    });
  }

  function listModes() {
    return CACHED_PRESETS ? Object.keys(CACHED_PRESETS).filter(function (k) { return !k.startsWith('_'); }) : [];
  }

  const api = Object.freeze({
    loadPresets: loadPresets,
    resolve: resolve,
    load: load,
    listModes: listModes,
  });

  const root = (typeof window !== 'undefined') ? window
             : (typeof globalThis !== 'undefined') ? globalThis
             : this;
  root.GlyphGrid = root.GlyphGrid || {};
  root.GlyphGrid.retro = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
