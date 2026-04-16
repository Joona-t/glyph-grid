/* Batch-render 3 glyph-grid scenes to animated GIFs in ~/Downloads.
 * Uses Playwright + the render.html __glyphGridTest hook.  For each
 * scene: beginRecord with a custom onFinish that stashes the resulting
 * JSZip blob; Node reads it out, unzips, Pillow stitches. */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const PIECE_URL = 'http://localhost:8776/';
const OUT_DIR   = '/tmp/paul-gifs';
const DL_DIR    = `${homedir()}/Downloads`;
const FPS       = 30;
const TOTAL     = 120;   /* 4 s loop */

const SCENES = [
  { id: 'plain',    scene: 'paulPortraitPlain', label: 'v1-warm-ochre' },
  { id: 'eyes',     scene: 'paulPortraitEyes',  label: 'v2-ethereal-glow-eyes' },
  { id: 'stardust', scene: 'paulPortrait',      label: 'v3-ethereal-glow-stardust' },
];

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 800, height: 800 },
  deviceScaleFactor: 1,
});

for (const s of SCENES) {
  console.log(`\n-> ${s.id} (${s.scene})`);

  /* Fresh page per scene so p5's noLoop after a record doesn't persist. */
  const page = await ctx.newPage();
  await page.goto(PIECE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__glyphGridTest, null, { timeout: 15_000 });

  /* Let p5 finish preload + first draws before we swap scenes. */
  await page.waitForTimeout(600);

  await page.evaluate((args) => {
    const h = window.__glyphGridTest;
    h.setConfig({ scene: args.scene, record: true, seed: 1 });
    window.__recStore = { blob: null };
    h.beginRecord({
      total: args.total,
      fps: args.fps,
      onFinish: (blob) => { window.__recStore.blob = blob; },
    });
  }, { scene: s.scene, total: TOTAL, fps: FPS });

  await page.waitForFunction(
    () => window.__recStore && !!window.__recStore.blob,
    null,
    { timeout: 180_000 }
  );

  /* Read blob as base64 via FileReader, round-trip via evaluate. */
  const base64 = await page.evaluate(async () => {
    const blob = window.__recStore.blob;
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result.split(',')[1]);
      fr.readAsDataURL(blob);
    });
  });

  await page.close();

  const zipPath   = `${OUT_DIR}/${s.id}.zip`;
  const framesDir = `${OUT_DIR}/${s.id}-frames`;
  const zipBuf    = Buffer.from(base64, 'base64');
  writeFileSync(zipPath, zipBuf);
  mkdirSync(framesDir, { recursive: true });
  execFileSync('unzip', ['-q', zipPath, '-d', framesDir]);
  console.log(`   wrote ${zipPath} (${(zipBuf.length / 1024).toFixed(0)} KB)`);

  const gifPath = `${DL_DIR}/paul-${s.label}.gif`;
  execFileSync('python3', ['/tmp/stitch-gif.py', framesDir, gifPath, String(FPS)],
               { stdio: 'inherit' });
}

await browser.close();
console.log('\nAll done.');
