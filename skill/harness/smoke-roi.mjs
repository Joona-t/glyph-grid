/* Wave D smoke — ROI density bump test.  Capture two frames of
 * sparkyPortrait: one without ROI, one with an ROI around Sparky's
 * head at bump=3.  The ROI area should visibly show finer detail. */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE = resolve(__dirname, '..', 'scripts', 'render.html');
const OUT = resolve(__dirname, 'smoke', 'wave-d');
mkdirSync(OUT, { recursive: true });

async function grab(ctx, overrides, name) {
  const page = await ctx.newPage();
  await page.goto('file://' + PIECE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.evaluate((cfg) => {
    const h = window.__glyphGridTest;
    h.setConfig(cfg);
    window.__recStore = null;
    h.beginRecord({
      total: 1, fps: 30,
      onFinish: (blob) => { window.__recStore = blob; },
    });
  }, overrides);
  await page.waitForFunction(() => window.__recStore !== null, null, { timeout: 30_000 });
  const canvas = await page.$('canvas');
  const png = await canvas.screenshot({ type: 'png' });
  writeFileSync(`${OUT}/${name}.png`, png);
  console.log('  ->', name);
  await page.close();
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });

console.log('[1/2] baseline — no ROI');
await grab(ctx, { scene: 'sparkyPortrait', grid: { cols: 100, rows: 100 } }, 'no-roi');

console.log('[2/2] with ROI at bump=3 around Sparky head');
await grab(ctx, {
  scene: 'sparkyPortrait',
  grid: {
    cols: 100, rows: 100,
    salientROIs: [{ x: 0.30, y: 0.30, w: 0.40, h: 0.40, bump: 3 }],
  },
}, 'with-roi-bump3');

await browser.close();
console.log('\nDone — eyeball smoke/wave-d/*.png.');
