import { homography, warp } from './geometry.js';
import { detectCard, detectBorders, CARD_W, CARD_H } from './detect.js';

const S = 16; // flattened image resolution, px per mm
const M = 2 * S; // margin around the flattened card so its edge is visible
const FW = CARD_W * S + 2 * M;
const FH = CARD_H * S + 2 * M;
const MAX_SRC = 2600; // cap very large photos
const SIDES = ['left', 'right', 'top', 'bottom'];
const ACCENT = '#ff4fd8';
const EDGE = '#35e06f';

const $ = (id) => document.getElementById(id);
const photoCv = $('photo');
const flatCv = $('flat');

const state = {
  srcCanvas: null, // the photo, as a canvas
  src: null, // its ImageData
  corners: null, // [TL, TR, BR, BL] in photo pixels
  flatCanvas: document.createElement('canvas'),
  flat: null,
  borders: null, // { left, right, top, bottom } in mm
  cardFound: true,
  bordersFound: true,
  drag: null,
};
state.flatCanvas.width = FW;
state.flatCanvas.height = FH;
window.cc = state; // handy for debugging from the console

// ---------- pipeline ----------

async function load(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SRC / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  state.srcCanvas = c;
  state.src = ctx.getImageData(0, 0, c.width, c.height);
  $('drop').hidden = true;
  $('work').hidden = false;
  $('redetect').hidden = false;
  detectAll();
}

function detectAll() {
  const res = detectCard(state.srcCanvas);
  state.corners = res.corners;
  state.cardFound = res.found;
  state.debug = res.debug;
  flatten();
  measureBorders();
  render();
}

function flatten() {
  const dst = [
    [M, M],
    [M + CARD_W * S, M],
    [M + CARD_W * S, M + CARD_H * S],
    [M, M + CARD_H * S],
  ];
  const H = homography(dst, state.corners);
  state.flat = warp(state.src, H, FW, FH);
  state.flatCanvas.getContext('2d').putImageData(state.flat, 0, 0);
}

function measureBorders() {
  const b = detectBorders(state.flat, S, M);
  state.borderInfo = b;
  state.borders = Object.fromEntries(SIDES.map((s) => [s, b[s].mm]));
  state.bordersFound = SIDES.every((s) => b[s].found);
}

// ---------- drawing ----------

function fit(canvas, w, h) {
  const stage = canvas.parentElement;
  const availW = stage.clientWidth || 400;
  const availH = Math.max(320, window.innerHeight - 170);
  const k = Math.min(availW / w, availH / h);
  const cw = Math.round(w * k);
  const ch = Math.round(h * k);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  return { ctx, k, cw, ch };
}

function drawPhoto() {
  const { srcCanvas, corners, drag } = state;
  const { ctx, k, cw, ch } = fit(photoCv, srcCanvas.width, srcCanvas.height);
  photoCv._k = k;
  ctx.drawImage(srcCanvas, 0, 0, cw, ch);
  const P = corners.map(([x, y]) => [(x + 0.5) * k, (y + 0.5) * k]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = EDGE;
  ctx.beginPath();
  P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  P.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(53,224,111,0.25)';
    ctx.fill();
    ctx.stroke();
  });
  if (drag && drag.type === 'corner') {
    // magnifier, in the top corner away from the one being dragged
    const [cx, cy] = corners[drag.index];
    const size = Math.min(170, cw * 0.45);
    const zoomSrc = 36; // photo pixels shown across the magnifier
    const lx = P[drag.index][0] < cw / 2 ? cw - size - 8 : 8;
    const ly = P[drag.index][1] < ch / 2 ? ch - size - 8 : 8;
    ctx.save();
    ctx.beginPath();
    ctx.rect(lx, ly, size, size);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    const z = size / zoomSrc;
    ctx.drawImage(srcCanvas, lx + size / 2 - (cx + 0.5) * z, ly + size / 2 - (cy + 0.5) * z, srcCanvas.width * z, srcCanvas.height * z);
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const n = corners.length;
    for (const j of [(drag.index + 1) % n, (drag.index + n - 1) % n]) {
      ctx.moveTo(lx + size / 2, ly + size / 2);
      ctx.lineTo(lx + size / 2 + (corners[j][0] - cx) * z, ly + size / 2 + (corners[j][1] - cy) * z);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(lx, ly, size, size);
  }
}

// Position of each border line on the flattened canvas, in flat pixels.
function linePos(side) {
  const mm = state.borders[side];
  if (side === 'left') return M + mm * S;
  if (side === 'right') return M + (CARD_W - mm) * S;
  if (side === 'top') return M + mm * S;
  return M + (CARD_H - mm) * S;
}

function drawFlat() {
  const { ctx, k, cw, ch } = fit(flatCv, FW, FH);
  flatCv._k = k;
  ctx.drawImage(state.flatCanvas, 0, 0, cw, ch);
  const x0 = M * k;
  const y0 = M * k;
  const x1 = (M + CARD_W * S) * k;
  const y1 = (M + CARD_H * S) * k;
  const L = linePos('left') * k;
  const R = linePos('right') * k;
  const T = linePos('top') * k;
  const B = linePos('bottom') * k;
  // tint the measured border
  ctx.fillStyle = 'rgba(255,79,216,0.16)';
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.rect(L, T, R - L, B - T);
  ctx.fill('evenodd');
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = EDGE;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = ACCENT;
  ctx.beginPath();
  ctx.moveTo(L, y0); ctx.lineTo(L, y1);
  ctx.moveTo(R, y0); ctx.lineTo(R, y1);
  ctx.moveTo(x0, T); ctx.lineTo(x1, T);
  ctx.moveTo(x0, B); ctx.lineTo(x1, B);
  ctx.stroke();
  // labels
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const label = (text, x, y, align) => {
    ctx.textAlign = align;
    const w = ctx.measureText(text).width + 10;
    const bx = align === 'left' ? x - 5 : align === 'right' ? x - w + 5 : x - w / 2;
    ctx.fillStyle = 'rgba(15,17,21,0.85)';
    ctx.fillRect(bx, y - 10, w, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
  };
  const fmt = (s) => state.borders[s].toFixed(2) + ' mm';
  label(fmt('left'), L + 10, (y0 + y1) / 2, 'left');
  label(fmt('right'), R - 10, (y0 + y1) / 2, 'right');
  label(fmt('top'), (x0 + x1) / 2, T + 16, 'center');
  label(fmt('bottom'), (x0 + x1) / 2, B - 16, 'center');
}

function split(a, b) {
  const p = (100 * a) / (a + b);
  return [p, 100 - p];
}

function drawResults() {
  const { left, right, top, bottom } = state.borders;
  const lr = split(left, right);
  const tb = split(top, bottom);
  $('lr').textContent = `${lr[0].toFixed(1)} / ${lr[1].toFixed(1)}`;
  $('tb').textContent = `${tb[0].toFixed(1)} / ${tb[1].toFixed(1)}`;
  $('lrbar').style.width = lr[0] + '%';
  $('tbbar').style.width = tb[0] + '%';
  for (const s of SIDES) $('mm-' + s).textContent = state.borders[s].toFixed(2) + ' mm';
  const worst = Math.max(...lr, ...tb);
  const tiers = [
    [55, '55/45 or better on both axes — inside the usual PSA 10 front guideline.'],
    [60, 'Within 60/40 — the usual PSA 9 front guideline.'],
    [65, 'Within 65/35 — the usual PSA 8 front guideline.'],
    [70, 'Within 70/30 — the usual PSA 7 front guideline.'],
  ];
  const tier = tiers.find(([lim]) => worst <= lim + 0.05);
  $('grade').textContent = tier ? tier[1] : 'Worse than 70/30 on at least one axis.';
  const st = $('status');
  if (!state.cardFound) {
    st.textContent = "Couldn't find the card automatically. Drag the green corners onto the card's corners.";
    st.hidden = false;
  } else if (!state.bordersFound) {
    st.textContent = "Couldn't find every border line. Drag the pink lines to where the art begins.";
    st.hidden = false;
  } else {
    st.hidden = true;
  }
}

function render() {
  if (!state.src) return;
  drawPhoto();
  drawFlat();
  drawResults();
}

// ---------- interaction ----------

function pointer(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

photoCv.addEventListener('pointerdown', (e) => {
  const [px, py] = pointer(photoCv, e);
  const k = photoCv._k;
  let best = -1;
  let bd = 28;
  state.corners.forEach(([x, y], i) => {
    const d = Math.hypot((x + 0.5) * k - px, (y + 0.5) * k - py);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  if (best < 0) return;
  photoCv.setPointerCapture(e.pointerId);
  state.drag = { type: 'corner', index: best, last: [px, py] };
  drawPhoto();
});

photoCv.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d || d.type !== 'corner') return;
  const [px, py] = pointer(photoCv, e);
  const gain = (e.shiftKey ? 0.15 : 1) / photoCv._k;
  const c = state.corners[d.index];
  c[0] = Math.min(state.src.width - 1, Math.max(0, c[0] + (px - d.last[0]) * gain));
  c[1] = Math.min(state.src.height - 1, Math.max(0, c[1] + (py - d.last[1]) * gain));
  d.last = [px, py];
  state.cardFound = true;
  if (!d.pending) {
    d.pending = true;
    requestAnimationFrame(() => {
      d.pending = false;
      flatten();
      drawPhoto();
      drawFlat();
    });
  }
});

function endCornerDrag() {
  if (!state.drag || state.drag.type !== 'corner') return;
  state.drag = null;
  flatten();
  measureBorders();
  render();
}
photoCv.addEventListener('pointerup', endCornerDrag);
photoCv.addEventListener('pointercancel', endCornerDrag);

flatCv.addEventListener('pointerdown', (e) => {
  const [px, py] = pointer(flatCv, e);
  const k = flatCv._k;
  let best = null;
  let bd = 14;
  for (const s of SIDES) {
    const vertical = s === 'left' || s === 'right';
    const d = Math.abs(linePos(s) * k - (vertical ? px : py));
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  if (!best) return;
  flatCv.setPointerCapture(e.pointerId);
  state.drag = { type: 'line', side: best, last: [px, py] };
});

flatCv.addEventListener('pointermove', (e) => {
  const [px, py] = pointer(flatCv, e);
  const d = state.drag;
  if (!d || d.type !== 'line') {
    const k = flatCv._k;
    const near = state.borders && SIDES.find((s) => Math.abs(linePos(s) * k - (s === 'left' || s === 'right' ? px : py)) < 14);
    flatCv.style.cursor = !near ? 'default' : near === 'left' || near === 'right' ? 'ew-resize' : 'ns-resize';
    return;
  }
  const gain = (e.shiftKey ? 0.15 : 1) / (flatCv._k * S);
  const s = d.side;
  const delta = s === 'left' || s === 'right' ? px - d.last[0] : py - d.last[1];
  const sign = s === 'left' || s === 'top' ? 1 : -1;
  state.borders[s] = Math.min(20, Math.max(0.1, state.borders[s] + sign * delta * gain));
  state.bordersFound = true;
  d.last = [px, py];
  drawFlat();
  drawResults();
});

const endLineDrag = () => {
  if (state.drag && state.drag.type === 'line') state.drag = null;
};
flatCv.addEventListener('pointerup', endLineDrag);
flatCv.addEventListener('pointercancel', endLineDrag);

$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) load(f);
  e.target.value = '';
});
$('sample').addEventListener('click', async () => {
  const r = await fetch('samples/latias-latios-gx.webp');
  load(await r.blob());
});
$('redetect').addEventListener('click', () => state.src && detectAll());

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('over');
});
window.addEventListener('dragleave', () => document.body.classList.remove('over'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('over');
  const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
  if (f) load(f);
});
window.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) load(f);
});
window.addEventListener('resize', render);
