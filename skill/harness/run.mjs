/* run.mjs — "full regression" driver.
 *
 * Reads harness/manifest.json (list of { piece, seed, frame, threshold }),
 * runs capture.mjs for each, then diff.mjs against harness/goldens/,
 * aggregates results to stdout, exits non-zero on any fail.
 *
 * Usage:
 *   node run.mjs              (run all entries)
 *   node run.mjs --regen      (overwrite goldens from current code — destructive)
 *
 * When run without a manifest, it defaults to:
 *   [{ piece: '../scripts/render.html', seed: 1, frame: 0, threshold: 1.0 }]
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadManifest() {
  const p = join(__dirname, 'manifest.json');
  if (!existsSync(p)) {
    return [{ piece: resolve(__dirname, '..', 'scripts', 'render.html'),
              seed: 1, frame: 0, threshold: 1.0 }];
  }
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function run(entry, regen) {
  const pieceAbs = resolve(__dirname, entry.piece);
  const captureArgs = ['capture.mjs',
    '--piece', pieceAbs,
    '--seed', String(entry.seed),
    '--frame', String(entry.frame),
  ];
  if (regen) captureArgs.push('--goldens');

  const cap = spawnSync('node', captureArgs, { cwd: __dirname, encoding: 'utf-8' });
  if (cap.status !== 0) {
    return { entry, pass: false, reason: 'capture-failed', stderr: cap.stderr };
  }
  const candidatePath = cap.stdout.trim();

  if (regen) return { entry, pass: true, reason: 'regenerated', path: candidatePath };

  const goldenPath = join(__dirname, 'goldens',
    candidatePath.split('/').pop().replace(/^.*?_seed/, `_seed`).replace(/^_/, '') || '');
  /* Recompute the expected golden path the same way capture writes names. */
  const realGolden = candidatePath.replace('/captures/', '/goldens/');
  if (!existsSync(realGolden)) {
    return { entry, pass: false, reason: 'no-golden', expected: realGolden,
             hint: 'run `node run.mjs --regen` to create goldens' };
  }

  const diff = spawnSync('node', ['diff.mjs', realGolden, candidatePath,
                                   '--threshold', String(entry.threshold)],
                         { cwd: __dirname, encoding: 'utf-8' });
  let parsed = null;
  try { parsed = JSON.parse(diff.stdout); } catch (_) {}
  return { entry, pass: diff.status === 0, result: parsed };
}

const regen = process.argv.includes('--regen');
const manifest = loadManifest();
const results = manifest.map((m) => run(m, regen));
console.log(JSON.stringify(results, null, 2));
const anyFail = results.some((r) => !r.pass);
process.exit(anyFail ? 1 : 0);
