/* =========================================================================
   Rostrum — photo motion engine
   Pure Canvas 2D. No dependencies. Browser only.

   Every effect is loop-safe: draw(ctx, S, 0) === draw(ctx, S, 1), so a clip
   recorded over exactly one cycle can be looped seamlessly.

   Usage:
     const S = createSource(imageEl, 720, 480);
     renderFrame(ctx, S, EFFECTS[0], t);   // t in [0,1)
   ========================================================================= */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pingpong = (t) => (t < 0.5 ? t * 2 : 2 - t * 2);
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const wave = (t) => 0.5 - 0.5 * Math.cos(t * TAU); // 0 -> 1 -> 0, loop-safe

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

function drawCover(ctx, img, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih);
  const dw = iw * s;
  const dh = ih * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/* ---------- shared lazy assets ---------- */

let _noise = null;
function noiseTile() {
  if (_noise) return _noise;
  const n = makeCanvas(180, 180);
  const d = n.ctx.createImageData(180, 180);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = 90 + Math.random() * 165;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  n.ctx.putImageData(d, 0, 0);
  _noise = n.canvas;
  return _noise;
}

let _orb = null;
function orbSprite() {
  if (_orb) return _orb;
  const size = 128;
  const o = makeCanvas(size, size);
  const g = o.ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.32)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  o.ctx.fillStyle = g;
  o.ctx.fillRect(0, 0, size, size);
  _orb = o.canvas;
  return _orb;
}

/* ---------- source ---------- */

/**
 * Pre-fit an image into a w x h buffer and cache the pixel data.
 * One Source can drive every effect and can be reused across frames.
 */
export function createSource(img, w, h) {
  w = Math.max(2, Math.round(w));
  h = Math.max(2, Math.round(h));
  const base = document.createElement('canvas');
  base.width = w;
  base.height = h;
  const bctx = base.getContext('2d', { willReadFrequently: true });
  drawCover(bctx, img, w, h);

  const frame = bctx.getImageData(0, 0, w, h);
  const out = bctx.createImageData(w, h);
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;

  return {
    img,
    w,
    h,
    base,
    bctx,
    data: frame.data,
    out,
    scratch: makeCanvas(w, h),
    cache: {},
  };
}

function lumTable(S) {
  if (S.cache._lum) return S.cache._lum;
  const { w, h, data } = S;
  const l = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < l.length; p++, i += 4) {
    l[p] = (data[i] * 77 + data[i + 1] * 151 + data[i + 2] * 28) >> 8;
  }
  S.cache._lum = l;
  return l;
}

/* ---------- transform helper ---------- */

function drawScaled(ctx, S, z, ox = 0, oy = 0) {
  const cx = S.w / 2;
  const cy = S.h / 2;
  ctx.setTransform(z, 0, 0, z, cx - cx * z + ox, cy - cy * z + oy);
  ctx.drawImage(S.base, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* =========================================================================
   EFFECTS
   ========================================================================= */

export const EFFECTS = [
  {
    id: 'kenburns',
    name: 'Slow push',
    note: 'Classic rostrum move: a gentle zoom with a drift across the frame.',
    draw(ctx, S, t) {
      const u = ease(pingpong(t));
      const z = 1 + 0.14 * u;
      drawScaled(ctx, S, z, (u - 0.5) * S.w * 0.06, (u - 0.5) * S.h * -0.04);
    },
  },

  {
    id: 'sway',
    name: 'Sway',
    note: 'A shallow lean side to side, as if the frame were hanging.',
    draw(ctx, S, t) {
      const a = Math.sin(t * TAU);
      const z = 1.1;
      const skew = a * 0.028;
      const cx = S.w / 2;
      const cy = S.h / 2;
      ctx.setTransform(z, 0, skew, z, cx - z * cx - skew * cy + a * S.w * 0.012, cy - z * cy);
      ctx.drawImage(S.base, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
  },

  {
    id: 'breathe',
    name: 'Breathe',
    note: 'Scale and light rise and fall together at a resting pace.',
    draw(ctx, S, t) {
      const u = wave(t);
      drawScaled(ctx, S, 1 + 0.038 * u);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,248,232,${0.07 * u})`;
      ctx.fillRect(0, 0, S.w, S.h);
      ctx.globalCompositeOperation = 'source-over';
    },
  },

  {
    id: 'glitch',
    name: 'Glitch',
    note: 'Channel separation with torn scanbands. Deliberately unstable.',
    draw(ctx, S, t) {
      const { w, h } = S;
      const bucket = Math.floor(t * 20);
      const rnd = mulberry32(bucket * 2654435761 + 7);
      const dx = (rnd() - 0.5) * w * 0.035;

      const sc = S.scratch;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      for (const [tint, off] of [['#ff0000', dx], ['#00ffff', -dx]]) {
        sc.ctx.globalCompositeOperation = 'source-over';
        sc.ctx.clearRect(0, 0, w, h);
        sc.ctx.drawImage(S.base, 0, 0);
        sc.ctx.globalCompositeOperation = 'multiply';
        sc.ctx.fillStyle = tint;
        sc.ctx.fillRect(0, 0, w, h);
        sc.ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(sc.canvas, off, 0);
      }
      ctx.globalCompositeOperation = 'source-over';

      const bands = 5 + Math.floor(rnd() * 5);
      for (let i = 0; i < bands; i++) {
        const by = Math.floor(rnd() * h);
        const bh = Math.max(2, Math.floor(rnd() * h * 0.05));
        const ox = (rnd() - 0.5) * w * 0.12;
        ctx.drawImage(S.base, 0, by, w, bh, ox, by, w, bh);
      }
      if (rnd() > 0.72) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(0, rnd() * h, w, 2);
      }
    },
  },

  {
    id: 'ripple',
    name: 'Ripple',
    note: 'Concentric displacement travelling out from the centre.',
    draw(ctx, S, t) {
      const { w, h, data, out } = S;
      const o = out.data;
      const ph = t * TAU;
      const cx = w / 2;
      const cy = h / 2;
      const maxd = Math.hypot(cx, cy);
      for (let y = 0; y < h; y++) {
        const dy = y - cy;
        for (let x = 0; x < w; x++) {
          const dx = x - cx;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const amp = 7 * (1 - d / maxd);
          const off = Math.sin(d * 0.07 - ph * 2) * amp;
          const sx = clamp((x + (dx / d) * off) | 0, 0, w - 1);
          const sy = clamp((y + (dy / d) * off) | 0, 0, h - 1);
          const si = (sy * w + sx) << 2;
          const di = (y * w + x) << 2;
          o[di] = data[si];
          o[di + 1] = data[si + 1];
          o[di + 2] = data[si + 2];
        }
      }
      ctx.putImageData(out, 0, 0);
    },
  },

  {
    id: 'shine',
    name: 'Shine',
    note: 'A hard light raking across the surface once per cycle.',
    draw(ctx, S, t) {
      const { w, h } = S;
      drawScaled(ctx, S, 1.02);
      const x = -0.5 * w + t * 2 * w;
      const g = ctx.createLinearGradient(x, 0, x + 0.4 * w, h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    },
  },

  {
    id: 'projector',
    name: 'Projector',
    note: 'Gate weave, flicker, grain and a burnt vignette. 8mm behaviour.',
    draw(ctx, S, t) {
      const { w, h } = S;
      const bucket = Math.floor(t * 14);
      const rnd = mulberry32(bucket * 40503 + 3);
      const jx = (rnd() - 0.5) * w * 0.006;
      const jy = (rnd() - 0.5) * h * 0.008;
      drawScaled(ctx, S, 1.03, jx, jy);

      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.3;
      const nt = noiseTile();
      ctx.drawImage(nt, -rnd() * 180, -rnd() * 180, w + 180, h + 180);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      ctx.fillStyle = `rgba(255,214,150,0.10)`;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.09})`;
      ctx.fillRect(0, 0, w, h);

      const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(20,10,0,0.6)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
    },
  },

  {
    id: 'dissolve',
    name: 'Dissolve',
    note: 'The image breaks into a grid of fragments and reassembles.',
    draw(ctx, S, t) {
      const { w, h } = S;
      const u = ease(pingpong(t));
      const step = clamp(Math.round(w / 90), 4, 14);
      const key = 'dis' + step;
      if (!S.cache[key]) {
        const rnd = mulberry32(99);
        const cols = Math.ceil(w / step);
        const rows = Math.ceil(h / step);
        const vx = new Float32Array(cols * rows);
        const vy = new Float32Array(cols * rows);
        for (let i = 0; i < vx.length; i++) {
          const a = rnd() * TAU;
          const m = 20 + rnd() * 90;
          vx[i] = Math.cos(a) * m;
          vy[i] = Math.sin(a) * m - 25;
        }
        S.cache[key] = { cols, rows, vx, vy };
      }
      const { cols, rows, vx, vy } = S.cache[key];
      ctx.fillStyle = '#0c0d10';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1 - u * 0.75;
      for (let r = 0, i = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++, i++) {
          const sx = c * step;
          const sy = r * step;
          ctx.drawImage(S.base, sx, sy, step, step, sx + vx[i] * u, sy + vy[i] * u, step, step);
        }
      }
      ctx.globalAlpha = 1;
    },
  },

  {
    id: 'duotone',
    name: 'Duotone cycle',
    note: 'Luminance mapped onto two colours that rotate through the wheel.',
    draw(ctx, S, t) {
      const { w, h, out } = S;
      const lum = lumTable(S);
      const o = out.data;
      const hue = t * 360;
      const lut = new Uint8Array(768);
      const a = hsl(hue, 0.7, 0.16);
      const b = hsl((hue + 62) % 360, 0.85, 0.68);
      for (let i = 0; i < 256; i++) {
        const k = i / 255;
        lut[i * 3] = a[0] + (b[0] - a[0]) * k;
        lut[i * 3 + 1] = a[1] + (b[1] - a[1]) * k;
        lut[i * 3 + 2] = a[2] + (b[2] - a[2]) * k;
      }
      for (let p = 0, di = 0; p < lum.length; p++, di += 4) {
        const li = lum[p] * 3;
        o[di] = lut[li];
        o[di + 1] = lut[li + 1];
        o[di + 2] = lut[li + 2];
      }
      ctx.putImageData(out, 0, 0);
    },
  },

  {
    id: 'zoomblur',
    name: 'Zoom pulse',
    note: 'Radial streaking that surges and settles.',
    draw(ctx, S, t) {
      const u = wave(t);
      ctx.drawImage(S.base, 0, 0);
      ctx.globalAlpha = 0.15;
      for (let i = 1; i <= 9; i++) drawScaled(ctx, S, 1 + (i / 9) * 0.2 * u);
      ctx.globalAlpha = 1;
    },
  },

  {
    id: 'shutter',
    name: 'Shutter',
    note: 'Vertical slats slide out of register in a travelling wave.',
    draw(ctx, S, t) {
      const { w, h } = S;
      const n = 14;
      const sw = w / n;
      ctx.fillStyle = '#0b0b0d';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < n; i++) {
        const off = Math.sin(t * TAU - i * 0.42) * h * 0.07;
        ctx.drawImage(S.base, i * sw, 0, sw + 1, h, i * sw, off, sw + 1, h);
      }
    },
  },

  {
    id: 'vhs',
    name: 'VHS',
    note: 'Vertical roll, scanlines, chroma bleed and a tracking band.',
    draw(ctx, S, t) {
      const { w, h } = S;
      const roll = (t * h) % h;
      ctx.drawImage(S.base, 0, roll);
      ctx.drawImage(S.base, 0, roll - h);

      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16;
      ctx.drawImage(S.base, 3, roll);
      ctx.drawImage(S.base, 3, roll - h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (!S.cache._lines) {
        const l = makeCanvas(4, 4);
        l.ctx.fillStyle = 'rgba(0,0,0,0.28)';
        l.ctx.fillRect(0, 0, 4, 2);
        S.cache._lines = l.ctx.createPattern(l.canvas, 'repeat');
      }
      ctx.fillStyle = S.cache._lines;
      ctx.fillRect(0, 0, w, h);

      const band = ((t * 1.6) % 1) * h;
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(noiseTile(), 0, band, w, h * 0.05);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  },

  {
    id: 'flip',
    name: 'Card turn',
    note: 'The photograph turns on its vertical axis and shows its back.',
    draw(ctx, S, t) {
      const { w, h } = S;
      const c = Math.cos(t * TAU);
      const s = Math.abs(Math.sin(t * TAU));
      ctx.fillStyle = '#0b0b0d';
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2;
      ctx.setTransform(c, 0, 0, 1, cx - cx * c, 0);
      ctx.drawImage(S.base, 0, 0);
      ctx.fillStyle = `rgba(0,0,0,${0.6 * s})`;
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
  },

  {
    id: 'liquid',
    name: 'Liquid',
    note: 'A slow current runs through the surface, warping it as it goes.',
    draw(ctx, S, t) {
      const { w, h, data, out } = S;
      const o = out.data;
      const ph = t * TAU;
      // Separable displacement tables keep this cheap at full resolution.
      const ax = new Float32Array(h);
      const bx = new Float32Array(w);
      const cy = new Float32Array(w);
      const dy = new Float32Array(h);
      for (let y = 0; y < h; y++) {
        ax[y] = Math.sin(y * 0.021 + ph) * 9;
        dy[y] = Math.sin(y * 0.011 + ph * 2) * 4;
      }
      for (let x = 0; x < w; x++) {
        bx[x] = Math.sin(x * 0.013 + ph * 2) * 5;
        cy[x] = Math.cos(x * 0.019 - ph) * 6;
      }
      for (let y = 0; y < h; y++) {
        const a = ax[y];
        const d = dy[y];
        for (let x = 0; x < w; x++) {
          const sx = clamp((x + a + bx[x]) | 0, 0, w - 1);
          const sy = clamp((y + d + cy[x]) | 0, 0, h - 1);
          const si = (sy * w + sx) << 2;
          const di = (y * w + x) << 2;
          o[di] = data[si];
          o[di + 1] = data[si + 1];
          o[di + 2] = data[si + 2];
        }
      }
      ctx.putImageData(out, 0, 0);
    },
  },

  {
    id: 'bokeh',
    name: 'Bokeh',
    note: 'Out-of-focus lights drift across a cooled-down frame.',
    draw(ctx, S, t) {
      const { w, h } = S;
      drawScaled(ctx, S, 1.04);
      ctx.fillStyle = 'rgba(8,10,22,0.28)';
      ctx.fillRect(0, 0, w, h);

      if (!S.cache._orbs) {
        const rnd = mulberry32(2024);
        S.cache._orbs = Array.from({ length: 34 }, () => ({
          x: rnd(),
          y: rnd(),
          r: 0.03 + rnd() * 0.12,
          sp: 0.4 + rnd() * 1.2,
          ph: rnd() * TAU,
          a: 0.2 + rnd() * 0.55,
        }));
      }
      const sprite = orbSprite();
      ctx.globalCompositeOperation = 'lighter';
      for (const o of S.cache._orbs) {
        const px = (o.x + Math.sin(t * TAU + o.ph) * 0.03) * w;
        const py = ((o.y + t * 0.12 * o.sp) % 1) * h;
        const r = o.r * Math.min(w, h);
        ctx.globalAlpha = o.a * (0.6 + 0.4 * Math.sin(t * TAU * o.sp + o.ph));
        ctx.drawImage(sprite, px - r, py - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  },

  {
    id: 'spotlight',
    name: 'Spotlight',
    note: 'Everything falls away except a lamp travelling over the image.',
    draw(ctx, S, t) {
      const { w, h } = S;
      ctx.drawImage(S.base, 0, 0);
      const cx = w * (0.5 + 0.3 * Math.cos(t * TAU));
      const cy = h * (0.5 + 0.24 * Math.sin(t * TAU * 2));
      const r = Math.max(w, h);
      const g = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.45, 'rgba(0,0,0,0.28)');
      g.addColorStop(1, 'rgba(0,0,0,0.86)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
];

function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/* =========================================================================
   Frame rendering + watermark
   ========================================================================= */

export function renderFrame(ctx, S, effect, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, S.w, S.h);
  effect.draw(ctx, S, ((t % 1) + 1) % 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function drawWatermark(ctx, w, h, text = 'rostrum') {
  const pad = Math.max(8, Math.round(w * 0.018));
  const size = Math.max(11, Math.round(w * 0.026));
  ctx.save();
  ctx.font = `600 ${size}px ui-monospace, "JetBrains Mono", Menlo, monospace`;
  ctx.textBaseline = 'alphabetic';
  const tw = ctx.measureText(text).width;
  const bw = tw + pad * 1.6;
  const bh = size + pad * 0.9;
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#000';
  ctx.fillRect(w - bw - pad, h - bh - pad, bw, bh);
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#fff';
  ctx.fillText(text, w - bw - pad + pad * 0.8, h - pad - bh * 0.28);
  ctx.restore();
}

/* =========================================================================
   Recording
   ========================================================================= */

export function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return null;
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || null;
}

/**
 * Records whatever is being drawn to `canvas` for `seconds`.
 * The caller keeps its own render loop running; this only taps the stream.
 */
export function recordCanvas(canvas, { seconds = 4, fps = 30, bitrate = 8_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const mimeType = pickMimeType();
    if (!mimeType) {
      reject(new Error('This browser cannot record canvas video. Try Chrome, Edge or Firefox.'));
      return;
    }
    let stream;
    try {
      stream = canvas.captureStream(fps);
    } catch (e) {
      reject(new Error('captureStream is unavailable in this browser.'));
      return;
    }
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onerror = (e) => reject(e.error || new Error('Recording failed.'));
    rec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType });
    };
    rec.start();
    setTimeout(() => rec.state !== 'inactive' && rec.stop(), seconds * 1000);
  });
}

export function extensionFor(mimeType) {
  return mimeType && mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
