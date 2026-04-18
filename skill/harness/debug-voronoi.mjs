import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const PIECE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'render.html');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 320, height: 320 } });
const page = await ctx.newPage();
page.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
await page.goto('file://' + PIECE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.GlyphGrid?.runtime, null, { timeout: 10_000 });
const result = await page.evaluate(async () => {
  const rt = window.GlyphGrid.runtime;
  rt.initPool(320, 320, 80, 40);
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 320;
  const pl = rt.pipeline()
    .source('noise', { w: 320, h: 320 })
    .sampling('voronoi', { sites: 40, stride: 4 })
    .selection('brightness', { ramp: '.:-=+*#@' })
    .color('ramp-palette', { palette: 'synthwave' })
    .output('topology-aware-canvas', { bg: '#10002a', fontSize: 14 });
  const mCtx = rt.makeContext({ t: 0, frameIdx: 0, seed: 42, config: { canvas: { w: 320, h: 320 }, grid: { cols: 80, rows: 40 } } });
  mCtx.canvas = canvas;
  try {
    const out = await rt.run(pl, mCtx);
    // Inspect what was produced
    const info = {
      finalKeys: Object.keys(out || {}),
      cs: out.cellSignal ? { cols: out.cellSignal.cols, rows: out.cellSignal.rows, chans: Array.from(out.cellSignal.channels), sourceW: out.cellSignal.sourceW, sourceH: out.cellSignal.sourceH, topology: out.cellSignal.topology } : null,
      glyphsLen: out.glyphs ? out.glyphs.length : null,
      glyphsSample: out.glyphs ? Array.from(out.glyphs.slice(0, 10)) : null,
      rampFirst8: out.ramp ? out.ramp.slice(0, 8) : null,
      rgbLen: out.rgb ? out.rgb.length : null,
      rgbSample: out.rgb ? Array.from(out.rgb.slice(0, 12)) : null,
      cellXSample: out.cellSignal && out.cellSignal.cellX ? Array.from(out.cellSignal.cellX.slice(0, 5)) : null,
      cellYSample: out.cellSignal && out.cellSignal.cellY ? Array.from(out.cellSignal.cellY.slice(0, 5)) : null,
    };
    // Check canvas pixels
    const c2d = canvas.getContext('2d');
    const img = c2d.getImageData(0, 0, 320, 320);
    let nonBlack = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i] + img.data[i+1] + img.data[i+2] > 30) nonBlack++;
    }
    info.canvasNonBlackPixels = nonBlack;
    return info;
  } catch (e) {
    return { error: e.message };
  }
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
