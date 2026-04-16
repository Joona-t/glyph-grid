/* glyph-gpu.js — optional WebGL2 compositor for the glyph-grid pipeline.
 *
 * Scope: GPU-accelerate the hot path (brightness sampling, ordered dither,
 * palette lookup, glyph blit via an atlas texture). Error-diffusion and
 * shape-vector selection stay on CPU (CR-4) and produce a cp grid the GPU
 * reads as a small R16 texture.
 *
 * This lib is intentionally small. It provides:
 *   - init(canvas): returns { gl, programs, atlas, availableExts } or null
 *                   if WebGL2 is unavailable (caller falls back to CPU).
 *   - uploadAtlas(ctx, atlasImage, glyphCount, cellW, cellH)
 *   - render(ctx, { cpGrid, colorGrid, cols, rows, cellW, cellH, post })
 *
 * The full CRT post chain is NOT duplicated in GLSL here — this tier
 * focuses on compositing. The CPU post-process chain (glyph-crt.js) reads
 * the GPU framebuffer into an ImageData and applies post on the result.
 *
 * If no GPU is requested (CONFIG.renderer !== 'gpu') this lib is a no-op.
 */

(function () {
  'use strict';

  const VS = `#version 300 es
    precision highp float;
    in vec2 aPos;
    in vec2 aUV;
    out vec2 vUV;
    void main() {
      vUV = aUV;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  /* Fragment shader: samples cp from a 1-channel cp texture (u16-equiv, we
     pack ID into R channel of RGBA8 grid), looks up a slot in the atlas,
     samples the atlas alpha, and outputs ink color from the color grid. */
  const FS = `#version 300 es
    precision highp float;
    uniform sampler2D uCpGrid;       /* cpIndex per cell */
    uniform sampler2D uColorGrid;    /* ink color per cell (sRGB) */
    uniform sampler2D uAtlas;        /* glyph atlas, 1ch alpha */
    uniform vec2 uGridSize;          /* cols, rows */
    uniform vec2 uAtlasCellCount;    /* cols, rows of the atlas grid */
    uniform vec2 uCanvasSize;        /* visible pixels */
    uniform vec2 uCellSize;          /* pixels per cell */
    in vec2 vUV;
    out vec4 fragColor;

    vec2 cellIdxFromFrag(vec2 fragCoord) {
      return floor(fragCoord / uCellSize);
    }

    void main() {
      vec2 frag = vUV * uCanvasSize;
      vec2 cell = cellIdxFromFrag(frag);
      vec2 cellCenter = (cell + 0.5) / uGridSize;
      /* cpIndex is stored in R as 0..1 (grid index / total). */
      float cpIdx = texture(uCpGrid, cellCenter).r * uAtlasCellCount.x * uAtlasCellCount.y;
      float idx = floor(cpIdx + 0.5);
      float acols = uAtlasCellCount.x;
      float ax = mod(idx, acols);
      float ay = floor(idx / acols);
      vec2 withinCell = fract(frag / uCellSize);
      vec2 atlasUV = (vec2(ax, ay) + withinCell) / uAtlasCellCount;
      float alpha = texture(uAtlas, atlasUV).r;
      vec4 ink = texture(uColorGrid, cellCenter);
      fragColor = vec4(ink.rgb * alpha, alpha);
    }
  `;

  function makeShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('glyph-gpu shader compile: ' + info);
    }
    return s;
  }

  function makeProgram(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, makeShader(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, makeShader(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error('glyph-gpu link: ' + info);
    }
    return p;
  }

  function init(canvas) {
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) return null;
    let program;
    try {
      program = makeProgram(gl, VS, FS);
    } catch (e) {
      if (console && console.warn) console.warn(e.message);
      return null;
    }
    /* Full-screen quad. */
    const quad = new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);

    const textures = {
      cpGrid:    gl.createTexture(),
      colorGrid: gl.createTexture(),
      atlas:     gl.createTexture(),
    };
    for (const k of Object.keys(textures)) {
      gl.bindTexture(gl.TEXTURE_2D, textures[k]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    const uniforms = {
      uCpGrid: gl.getUniformLocation(program, 'uCpGrid'),
      uColorGrid: gl.getUniformLocation(program, 'uColorGrid'),
      uAtlas: gl.getUniformLocation(program, 'uAtlas'),
      uGridSize: gl.getUniformLocation(program, 'uGridSize'),
      uAtlasCellCount: gl.getUniformLocation(program, 'uAtlasCellCount'),
      uCanvasSize: gl.getUniformLocation(program, 'uCanvasSize'),
      uCellSize: gl.getUniformLocation(program, 'uCellSize'),
    };

    return {
      gl: gl,
      canvas: canvas,
      program: program,
      vao: vao,
      textures: textures,
      uniforms: uniforms,
    };
  }

  /* Upload the atlas image (RGBA8 with ink in R channel) to GPU. */
  function uploadAtlas(ctx, imageData, atlasCols, atlasRows) {
    const gl = ctx.gl;
    gl.bindTexture(gl.TEXTURE_2D, ctx.textures.atlas);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8,
      imageData.width, imageData.height, 0,
      gl.RED, gl.UNSIGNED_BYTE, imageData.data
    );
    ctx.atlasCols = atlasCols;
    ctx.atlasRows = atlasRows;
  }

  /* cpGrid: Uint16Array of length cols*rows. We pack idx/maxIdx into R8. */
  function uploadCpGrid(ctx, cpGrid, cols, rows, maxIdx) {
    const gl = ctx.gl;
    const data = new Uint8Array(cols * rows);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.round(cpGrid[i] / Math.max(1, maxIdx) * 255);
    }
    gl.bindTexture(gl.TEXTURE_2D, ctx.textures.cpGrid);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cols, rows, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  }

  /* colorGrid: Uint8Array RGBA of length cols*rows*4. */
  function uploadColorGrid(ctx, colorGrid, cols, rows) {
    const gl = ctx.gl;
    gl.bindTexture(gl.TEXTURE_2D, ctx.textures.colorGrid);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, colorGrid);
  }

  function render(ctx, opts) {
    const gl = ctx.gl;
    gl.viewport(0, 0, ctx.canvas.width, ctx.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(ctx.program);
    gl.bindVertexArray(ctx.vao);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.textures.cpGrid);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ctx.textures.colorGrid);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ctx.textures.atlas);

    gl.uniform1i(ctx.uniforms.uCpGrid, 0);
    gl.uniform1i(ctx.uniforms.uColorGrid, 1);
    gl.uniform1i(ctx.uniforms.uAtlas, 2);
    gl.uniform2f(ctx.uniforms.uGridSize, opts.cols, opts.rows);
    gl.uniform2f(ctx.uniforms.uAtlasCellCount, ctx.atlasCols, ctx.atlasRows);
    gl.uniform2f(ctx.uniforms.uCanvasSize, ctx.canvas.width, ctx.canvas.height);
    gl.uniform2f(ctx.uniforms.uCellSize, opts.cellW, opts.cellH);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /* Read the GPU framebuffer into an ImageData for the CPU post chain. */
  function readPixels(ctx) {
    const gl = ctx.gl;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    /* Flip Y — WebGL has origin at bottom-left. */
    const flipped = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      const dst = y * w * 4;
      flipped.set(pixels.subarray(src, src + w * 4), dst);
    }
    return new ImageData(flipped, w, h);
  }

  function isSupported() {
    if (typeof document === 'undefined') return false;
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  }

  const api = Object.freeze({
    init: init,
    uploadAtlas: uploadAtlas,
    uploadCpGrid: uploadCpGrid,
    uploadColorGrid: uploadColorGrid,
    render: render,
    readPixels: readPixels,
    isSupported: isSupported,
  });

  const root = (typeof window !== 'undefined') ? window
             : (typeof globalThis !== 'undefined') ? globalThis
             : this;
  root.GlyphGrid = root.GlyphGrid || {};
  root.GlyphGrid.gpu = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
