/* encode-gif.mjs — Node-native animated-GIF encoder.
 *
 * Replaces the Python `stitch-gif.py` shim so the harness has no
 * Python runtime dependency.  Decodes PNG frames via pngjs (already
 * an indirect dep) and feeds raw RGBA buffers straight to gif-encoder-2
 * so we avoid the native `canvas` module.
 *
 * Usage:
 *   import { encodeGif } from './lib/encode-gif.mjs';
 *   await encodeGif({ framesDir, outPath, fps, repeat: 0 });
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import GIFEncoder from 'gif-encoder-2';

export async function encodeGif({ framesDir, outPath, fps = 30, repeat = 0, quality = 10 }) {
  const files = readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
  if (files.length === 0) throw new Error(`no PNGs in ${framesDir}`);

  /* Probe dimensions from the first frame. */
  const firstBuf = readFileSync(join(framesDir, files[0]));
  const first = PNG.sync.read(firstBuf);
  const w = first.width, h = first.height;

  const encoder = new GIFEncoder(w, h, 'neuquant', true);
  encoder.setDelay(Math.round(1000 / fps));
  encoder.setRepeat(repeat);
  encoder.setQuality(quality);
  encoder.start();

  /* First frame is already decoded — feed it directly. */
  encoder.addFrame(first.data);

  for (let i = 1; i < files.length; i++) {
    const buf = readFileSync(join(framesDir, files[i]));
    const png = PNG.sync.read(buf);
    if (png.width !== w || png.height !== h) {
      throw new Error(`frame ${files[i]} has size ${png.width}x${png.height}, expected ${w}x${h}`);
    }
    encoder.addFrame(png.data);
  }

  encoder.finish();
  const gifBuf = encoder.out.getData();
  writeFileSync(outPath, gifBuf);
  return { outPath, frames: files.length, bytes: gifBuf.length, w, h };
}
