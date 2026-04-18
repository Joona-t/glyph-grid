/* Wave C smoke — verify god rays + letterbox land on the depthSmoke scene. */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIECE = resolve(__dirname, '..', 'scripts', 'render.html');
const OUT = resolve(__dirname, 'smoke', 'wave-c');
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
  console.log('  ->', name, `(${(png.length / 1024).toFixed(1)} KB)`);
  await page.close();
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });

console.log('[1/3] depthSmoke + god rays from top-left');
await grab(ctx, {
  scene: 'depthSmoke', colorMode: 'preserve', ramp: 'dense',
  postprocess: {
    godRays: { enabled: true, lightPos: [0.1, 0.05], strength: 0.8, steps: 48, threshold: 0.45 },
  },
}, 'god-rays');

console.log('[2/3] depthSmoke + letterbox 80px top/bottom');
await grab(ctx, {
  scene: 'depthSmoke', colorMode: 'preserve', ramp: 'dense',
  postprocess: {
    letterbox: { enabled: true, topPx: 80, bottomPx: 80, color: '#000000' },
  },
}, 'letterbox');

console.log('[3/3] combined — rays + letterbox');
await grab(ctx, {
  scene: 'depthSmoke', colorMode: 'preserve', ramp: 'dense',
  postprocess: {
    godRays: { enabled: true, lightPos: [0.5, 0.1], strength: 0.6, steps: 40, threshold: 0.5 },
    letterbox: { enabled: true, topPx: 60, bottomPx: 60, color: '#000000' },
  },
}, 'rays-plus-letterbox');

await browser.close();
console.log('\nDone — smoke/wave-c/*.png.');
