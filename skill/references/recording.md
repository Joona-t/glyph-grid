# recording.md — streaming recording (File System Access + fflate)

## Why streaming

The legacy path (`canvas.toDataURL` + `JSZip` in-memory) holds every frame in RAM until the ZIP is assembled. At 1080² × 30 fps × 12 s that's ~1.5 GB — an OOM on most laptops. Streaming writes each PNG as it's captured.

## Fallback chain (IM-5)

```
File System Access API  →  fflate worker  →  legacy JSZip
(Chromium / Edge)           (any browser)     (any browser)
```

- **File System Access API**: `showDirectoryPicker` lets the user grant a directory handle; each frame writes to disk immediately. No RAM growth. Firefox/Safari don't support it yet.
- **fflate worker**: streams frames into a `Zip` / `ZipPassThrough` in a Web Worker. Browser flushes compressed chunks incrementally; main thread stays responsive.
- **Legacy JSZip**: synchronous, documented size cap (~8 s at 1080²/30 fps).

`glyph-record.begin(opts)` negotiates automatically.

## API

```js
GlyphGrid.record.begin({ mode: 'auto' }).then(function (rec) {
  // rec.capture(canvas) returns a Promise<void>
  // rec.finish() returns a Promise<{ mode, blob?, directory?, frames }>
});
```

`opts.mode`:

- `'auto'` — try File System, then fflate, then JSZip. Recommended.
- `'filesystem'` — File System only. Rejects on unsupported browsers.
- `'fflate'` — fflate worker only.
- `'jszip'` — legacy only.

## Determinism

Recording does not affect determinism. The renderer runs the exact same pipeline with the same seed; only the output path differs. Byte-identical output across capture modes is guaranteed IF the browser and OS are the same — if the bundled Cascadia font is used, cross-OS/cross-browser parity holds for `compat: "v1"`.

## Render-mode + streaming

`render.html` currently keeps the legacy JSZip path for the `CONFIG.record` flow. To opt into streaming:

```js
CONFIG.record = true;
CONFIG.recording = { mode: 'auto' };  /* enables GlyphGrid.record instead of legacy path */
```

Under `compat: "v1"` the streaming recorder is gated OFF (`gateStreamingRecord` returns false). V1 pieces always record via the legacy path, preserving the frozen output contract.

## File output

- **File System Access**: directory contains `frame_00001.png`, `frame_00002.png`, … One per frame.
- **fflate/JSZip**: single ZIP blob with `frame_NNNNN.png` entries. Caller triggers download via `GlyphGrid.record.downloadBlob(blob, filename)`.

After export, assemble with ffmpeg:

```bash
ffmpeg -framerate 30 -i frame_%05d.png -c:v libx264 -pix_fmt yuv420p out.mp4
```

See `scripts/export-gif.sh` for the GIF variant.

## Browser support

| Feature | Chrome | Edge | Safari | Firefox |
|---|---|---|---|---|
| File System Access | 86+ | 86+ | 15.2 (read-only) | NO |
| fflate + Worker | all | all | all | all |
| JSZip (main thread) | all | all | all | all |

Safari has partial File System Access (File System Access Handle but no directory writable). `glyph-record.hasFileSystemWritable()` specifically checks for `showDirectoryPicker`, so Safari falls through to fflate.

## Recording contract for the test harness

The Playwright harness (`harness/capture.mjs`) uses the `__glyphGridTest.beginRecord` hook, which currently drives the legacy JSZip path with an `onFinish` callback. The harness DOESN'T exercise streaming — it captures one frame per test and screenshots the canvas directly, so the recording path isn't on its critical path. When we want a full-video regression harness, wire `beginRecord({ mode: 'fflate', onFinish })` through.
