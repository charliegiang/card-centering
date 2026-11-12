// Automatic detection: the card's four edges in a photo, and the border lines on the flattened card.
import { intersect } from './geometry.js';

export const CARD_W = 63; // mm, standard trading card
export const CARD_H = 88;
const ASPECT = CARD_W / CARD_H;

// Gradient units: colour magnitude of a central difference on 0-255 values.
const NOISE_FLOOR = 8; // below this a gradient is treated as texture noise
const CLIP = 60; // above this every edge counts the same, so faint-but-long edges are not drowned out

/** Downscale (area average) an ImageData-like { data, width, height } to at most maxDim, as float RGB planes. */
function workImage(src, maxDim) {
  const k = Math.min(1, maxDim / Math.max(src.width, src.height));
  const w = Math.round(src.width * k);
  const h = Math.round(src.height * k);
  const d = src.data;
  const sw = src.width;
  const ch = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / k);
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor((y + 1) / k)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / k);
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.floor((x + 1) / k)));
      let r = 0, g = 0, b = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const p = (yy * sw + xx) * 4;
          r += d[p];
          g += d[p + 1];
          b += d[p + 2];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const i = y * w + x;
      ch[0][i] = r / n;
      ch[1][i] = g / n;
      ch[2][i] = b / n;
    }
  }
  return { ch, w, h, k };
}

function blur(a, w, h) {
  const t = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = x > 0 ? a[i - 1] : a[i];
      const r = x < w - 1 ? a[i + 1] : a[i];
      t[i] = (l + 2 * a[i] + r) / 4;
    }
  }
  const o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const u = y > 0 ? t[i - w] : t[i];
      const d = y < h - 1 ? t[i + w] : t[i];
      o[i] = (u + 2 * t[i] + d) / 4;
    }
  }
  return o;
}

/** Colour gradient magnitudes across x (gx: responds to vertical edges) and across y (gy). */
function gradients(ch, w, h) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (const c of ch) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const dx = c[i + 1] - c[i - 1];
        const dy = c[i + w] - c[i - w];
        gx[i] += dx * dx;
        gy[i] += dy * dy;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    gx[i] = Math.sqrt(gx[i]);
    gy[i] = Math.sqrt(gy[i]);
  }
  return { gx, gy };
}

function clipped(g, clip = CLIP) {
  const o = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) {
    const v = g[i] - NOISE_FLOOR;
    o[i] = v <= 0 ? 0 : v > clip - NOISE_FLOOR ? clip - NOISE_FLOOR : v;
  }
  return o;
}

function smooth(P) {
  const o = new Float32Array(P.length);
  for (let i = 0; i < P.length; i++) {
    const a = i > 0 ? P[i - 1] : P[i];
    const b = i < P.length - 1 ? P[i + 1] : P[i];
    o[i] = (a + 2 * P[i] + b) / 4;
  }
  return o;
}

function parabola(P, i) {
  if (i <= 0 || i >= P.length - 1) return i;
  const den = P[i - 1] - 2 * P[i] + P[i + 1];
  return den === 0 ? i : i + (0.5 * (P[i - 1] - P[i + 1])) / den;
}

/** Local maxima of P between lo and hi, strongest first, at least minSep apart. */
export function findPeaks(P, lo, hi, minSep, maxCount) {
  const S = smooth(P);
  const c = [];
  for (let i = Math.max(1, lo); i < Math.min(P.length - 1, hi); i++) {
    if (S[i] > S[i - 1] && S[i] >= S[i + 1]) c.push({ pos: parabola(S, i), val: S[i] });
  }
  c.sort((a, b) => b.val - a.val);
  const out = [];
  for (const p of c) {
    if (out.every((q) => Math.abs(q.pos - p.pos) >= minSep)) out.push(p);
    if (out.length >= maxCount) break;
  }
  return out;
}

function lsq(pts) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) {
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (n < 2 || den === 0) return null;
  const a = (n * sxy - sx * sy) / den;
  return [a, (sy - a * sx) / n];
}

function robustFit(pts) {
  let keep = pts;
  let f = lsq(keep);
  for (let it = 0; it < 4 && f; it++) {
    const res = pts.map(([x, y]) => Math.abs(y - (f[0] * x + f[1])));
    const sorted = [...res].sort((a, b) => a - b);
    const mad = sorted[sorted.length >> 1];
    const thr = Math.max(0.6, 2.5 * 1.4826 * mad);
    keep = pts.filter((_, i) => res[i] <= thr);
    if (keep.length < 6) break;
    f = lsq(keep);
  }
  return f;
}

/**
 * Local line search around a coarse edge. Tries shifts (from `lo` to `hi` px across the line) and
 * tilts (within `tiltRange`), scoring each candidate by the (clipped) edge evidence along it.
 * With `outward` = 0 it returns the strongest line. With `outward` = -1 or +1 (the direction that
 * points off the card) it returns the outermost line that is at least half as strong as the
 * strongest: a card's physical edge is often fainter than the rim or print line just inside it.
 */
function lineSearch(cg, w, h, vertical, pos0, t0, from, to, lo, hi, tiltRange, tiltStep, outward) {
  const len = vertical ? h : w;
  const lim = vertical ? w : h;
  const DP = 0.25;
  const n = Math.round((hi - lo) / DP) + 1;
  const E = new Float32Array(n);
  const T = new Float32Array(n).fill(t0);
  for (let j = 0; j < n; j++) {
    const dp = lo + j * DP;
    for (let dt = -tiltRange; dt <= tiltRange + 1e-9; dt += tiltStep) {
      let score = 0;
      for (let s = Math.ceil(from); s <= to; s += 2) {
        const u = pos0 + dp + (t0 + dt) * (s - len / 2);
        const i = Math.floor(u);
        if (i < 1 || i >= lim - 2 || s < 1 || s >= len - 1) continue;
        const f = u - i;
        score += vertical
          ? cg[s * w + i] * (1 - f) + cg[s * w + i + 1] * f
          : cg[i * w + s] * (1 - f) + cg[(i + 1) * w + s] * f;
      }
      if (score > E[j]) {
        E[j] = score;
        T[j] = t0 + dt;
      }
    }
  }
  let jm = 0;
  for (let j = 1; j < n; j++) if (E[j] > E[jm]) jm = j;
  let j = jm;
  if (outward) {
    const peaks = [];
    for (let i = 1; i < n - 1; i++) if (E[i] >= E[i - 1] && E[i] > E[i + 1] && E[i] >= 0.5 * E[jm]) peaks.push(i);
    if (peaks.length) j = outward < 0 ? peaks[0] : peaks[peaks.length - 1];
  }
  return { pos: pos0 + lo + j * DP, t: T[j], score: E[j] };
}

/**
 * Refine one edge: at many points along it, find the strongest gradient within R px of the
 * coarse line, then fit a straight line through those points, ignoring outliers.
 * Returns [a, b] with x = a*y + b (vertical) or y = a*x + b (horizontal).
 */
function refineEdge(g, w, h, vertical, pos0, t, from, to, R) {
  const pts = [];
  const len = vertical ? h : w;
  const lim = vertical ? w : h;
  for (let s = Math.ceil(from); s <= to; s += 2) {
    if (s < 2 || s > len - 3) continue;
    const c = pos0 + t * (s - len / 2);
    const lo = Math.max(2, Math.round(c) - R);
    const hi = Math.min(lim - 3, Math.round(c) + R);
    const at = (p) => {
      let v = 0;
      for (let k = -1; k <= 1; k++) v += vertical ? g[(s + k) * w + p] : g[p * w + s + k];
      return v / 3;
    };
    let bp = -1;
    let bv = NOISE_FLOOR;
    for (let p = lo; p <= hi; p++) {
      const v = at(p);
      if (v > bv) {
        bv = v;
        bp = p;
      }
    }
    if (bp <= lo || bp >= hi) continue; // a maximum on the window's rim belongs to a neighbouring line
    const y0 = at(bp - 1);
    const y2 = at(bp + 1);
    const den = y0 - 2 * bv + y2;
    pts.push([s, den === 0 ? bp : bp + (0.5 * (y0 - y2)) / den]);
  }
  const f = pts.length >= 8 ? robustFit(pts) : null;
  return f || [t, pos0 - (t * len) / 2];
}

/** Edge weights that only count gradients running across the wanted direction (suppresses texture). */
function coherent(ga, gb) {
  const o = new Float32Array(ga.length);
  for (let i = 0; i < ga.length; i++) {
    if (ga[i] > 1.5 * gb[i]) {
      const v = ga[i] - NOISE_FLOOR;
      o[i] = v <= 0 ? 0 : v > CLIP - NOISE_FLOOR ? CLIP - NOISE_FLOOR : v;
    }
  }
  return o;
}

const TILTS = [];
for (let t = -0.36; t <= 0.3601; t += 0.02) TILTS.push(t);

/**
 * Hough transform for near-vertical lines x = pos + t*(y - h/2) (or near-horizontal lines
 * y = pos + t*(x - w/2)). Returns the strongest distinct lines.
 */
function houghLines(wt, w, h, vertical, maxCount) {
  const n = vertical ? w : h;
  const len = vertical ? h : w;
  const acc = TILTS.map(() => new Float32Array(n));
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = wt[y * w + x];
      if (!v) continue;
      const p = vertical ? x : y;
      const s = (vertical ? y : x) - len / 2;
      for (let ti = 0; ti < TILTS.length; ti++) {
        const i = Math.round(p - TILTS[ti] * s);
        if (i >= 0 && i < n) acc[ti][i] += v;
      }
    }
  }
  let max = 0;
  for (const a of acc) for (const v of a) if (v > max) max = v;
  const cells = [];
  acc.forEach((a, ti) => {
    for (let i = 2; i < n - 2; i++) if (a[i] >= 0.2 * max) cells.push({ t: TILTS[ti], pos: i, val: a[i] });
  });
  cells.sort((a, b) => b.val - a.val);
  const out = [];
  for (const c of cells) {
    // a line shows up in neighbouring cells too; keep one per neighbourhood
    if (out.every((o) => Math.abs(o.pos - c.pos) >= 5 + 60 * Math.abs(o.t - c.t))) out.push(c);
    if (out.length >= maxCount) break;
  }
  return out;
}

/** Share of a side (between two corners, ends skipped) that lies on edge pixels, weighted by strength. */
function support(wt, w, h, vertical, p0, p1) {
  const steps = Math.max(8, Math.round(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])));
  let n = 0;
  let sum = 0;
  for (let s = Math.round(0.1 * steps); s <= 0.9 * steps; s++) {
    const xi = Math.round(p0[0] + ((p1[0] - p0[0]) * s) / steps);
    const yi = Math.round(p0[1] + ((p1[1] - p0[1]) * s) / steps);
    n++;
    if (xi < 2 || yi < 2 || xi >= w - 2 || yi >= h - 2) continue;
    let v = 0;
    for (let k = -1; k <= 1; k++) v = Math.max(v, vertical ? wt[yi * w + xi + k] : wt[(yi + k) * w + xi]);
    sum += v / (CLIP - NOISE_FLOOR);
  }
  return n ? sum / n : 0;
}

/**
 * Width/height of the real rectangle behind a quad seen in perspective [TL, TR, BR, BL]
 * (Zhang & He, "Whiteboard scanning and image enhancement"). Falls back to the plain ratio of
 * side lengths when the view is close to straight-on.
 */
function quadAspect(c, w, h) {
  const m = (p) => [p[0] - w / 2, p[1] - h / 2, 1];
  const m1 = m(c[0]), m2 = m(c[1]), m3 = m(c[3]), m4 = m(c[2]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1];
  const dim = Math.max(w, h);
  if (Math.abs(n2[2]) > 0.02 && Math.abs(n3[2]) > 0.02) {
    const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
    if (f2 > (0.5 * dim) ** 2 && f2 < (5 * dim) ** 2) {
      return Math.sqrt((n2[0] ** 2 + n2[1] ** 2 + n2[2] ** 2 * f2) / (n3[0] ** 2 + n3[1] ** 2 + n3[2] ** 2 * f2));
    }
  }
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return (d(c[0], c[1]) + d(c[3], c[2])) / (d(c[0], c[3]) + d(c[1], c[2]));
}

/** Coarse search on a small copy of the photo: the best-supported quad with card proportions. */
function findQuad(src) {
  const { ch, w, h, k } = workImage(src, 420);
  const b = ch.map((c) => blur(c, w, h));
  const { gx, gy } = gradients(b, w, h);
  const wv = coherent(gx, gy);
  const wh = coherent(gy, gx);
  const V = houghLines(wv, w, h, true, 12).map((l) => ({ ...l, line: [l.t, l.pos - (l.t * h) / 2] })); // x = a*y + b
  const Hs = houghLines(wh, w, h, false, 12).map((l) => ({ ...l, line: [l.t, l.pos - (l.t * w) / 2] })); // y = a*x + b
  let best = null;
  const all = [];
  for (let a = 0; a < V.length; a++) {
    for (let c = 0; c < V.length; c++) {
      if (V[c].pos - V[a].pos < 0.15 * w) continue;
      for (let e = 0; e < Hs.length; e++) {
        for (let g = 0; g < Hs.length; g++) {
          if (Hs[g].pos - Hs[e].pos < 0.15 * h) continue;
          const q = [
            intersect(Hs[e].line, V[a].line),
            intersect(Hs[e].line, V[c].line),
            intersect(Hs[g].line, V[c].line),
            intersect(Hs[g].line, V[a].line),
          ];
          if (q.some(([x, y]) => x < -0.03 * w || x > 1.03 * w || y < -0.03 * h || y > 1.03 * h)) continue;
          if (q[1][0] - q[0][0] < 0.1 * w || q[2][0] - q[3][0] < 0.1 * w || q[3][1] - q[0][1] < 0.1 * h || q[2][1] - q[1][1] < 0.1 * h) continue;
          const dev = quadAspect(q, w, h) / ASPECT - 1;
          if (Math.abs(dev) > 0.15) continue;
          const area = 0.5 * Math.abs(
            (q[2][0] - q[0][0]) * (q[3][1] - q[1][1]) - (q[3][0] - q[1][0]) * (q[2][1] - q[0][1]),
          );
          const frac = area / (w * h);
          if (frac < 0.06) continue;
          const sup = [
            support(wv, w, h, true, q[0], q[3]),
            support(wv, w, h, true, q[1], q[2]),
            support(wh, w, h, false, q[0], q[1]),
            support(wh, w, h, false, q[3], q[2]),
          ];
          const mean = (sup[0] + sup[1] + sup[2] + sup[3]) / 4;
          const score = (0.5 * mean + 0.5 * Math.min(...sup)) * Math.exp(-0.5 * (dev / 0.05) ** 2) * frac ** 0.15;
          const cand = { score, q, sup, dev, frac };
          all.push(cand);
          if (!best || score > best.score) best = cand;
        }
      }
    }
  }
  // The print's own frame is often a stronger rectangle than the card's edge. If a slightly
  // larger, reasonably supported quad wraps the winner, that one is the card.
  const mid = (q) => ({
    l: (q[0][0] + q[3][0]) / 2,
    r: (q[1][0] + q[2][0]) / 2,
    t: (q[0][1] + q[1][1]) / 2,
    b: (q[3][1] + q[2][1]) / 2,
  });
  const first = best;
  for (let pass = 0; best && pass < 2; pass++) {
    const m = mid(best.q);
    const wd = m.r - m.l;
    const ht = m.b - m.t;
    let outer = null;
    for (const c of all) {
      if (c === best || c.score < 0.75 * best.score) continue;
      // a larger quad with worse proportions is a holder, halo or shadow, not the card
      if (Math.abs(c.dev) > Math.max(0.02, Math.abs(best.dev))) continue;
      const n = mid(c.q);
      const d = [m.l - n.l, n.r - m.r, m.t - n.t, n.b - m.b]; // how far each side sits outside the winner's
      const lim = [0.07 * wd, 0.07 * wd, 0.07 * ht, 0.07 * ht];
      if (d.some((v, i) => v < -0.75 || v > lim[i])) continue;
      if (d[0] + d[1] + d[2] + d[3] < 2) continue;
      if (!outer || c.score > outer.score) outer = c;
    }
    if (!outer) break;
    best = outer;
  }
  return { best, first, k, w, h };
}

/**
 * Find the card in a photo. Returns corners [TL, TR, BR, BL] in source-pixel coordinates,
 * plus `found: false` when it had to fall back to a guess.
 */
export function detectCard(src) {
  const coarse = findQuad(src);
  const { ch, w, h, k } = workImage(src, 1000);
  const toSrc = ([x, y]) => [(x + 0.5) / k - 0.5, (y + 0.5) / k - 0.5];
  if (!coarse.best || coarse.best.score < 0.12) {
    const ht = 0.8 * h;
    const wd = Math.min(0.8 * w, ht * ASPECT);
    const l = (w - wd) / 2, t = (h - wd / ASPECT) / 2;
    const corners = [[l, t], [l + wd, t], [l + wd, t + wd / ASPECT], [l, t + wd / ASPECT]].map(toSrc);
    return { corners, found: false, debug: { coarse: coarse.best } };
  }
  const f = k / coarse.k;
  const q = coarse.best.q.map(([x, y]) => [(x + 0.5) * f - 0.5, (y + 0.5) * f - 0.5]);
  const b = ch.map((c) => blur(c, w, h));
  const { gx, gy } = gradients(b, w, h);
  const cgx = clipped(gx);
  const cgy = clipped(gy);
  const cardW = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
  const edge = (vertical, A, B, outward) => {
    // A and B are the side's two corners; s runs along the side, p across it
    const [as, ap, bs, bp] = vertical ? [A[1], A[0], B[1], B[0]] : [A[0], A[1], B[0], B[1]];
    const len = vertical ? h : w;
    const t = (bp - ap) / (bs - as);
    const pos0 = ap + t * (len / 2 - as);
    const from = as + 0.1 * (bs - as);
    const to = bs - 0.1 * (bs - as);
    const cg = vertical ? cgx : cgy;
    // 1. lock on to the strongest real line near the coarse one, with plenty of freedom to tilt
    const a = lineSearch(cg, w, h, vertical, pos0, t, from, to, -4, 4, 0.03, 0.003, 0);
    // 2. then look a little further out for a fainter parallel line: a dull rim is still card
    const r2 = Math.max(3, 0.011 * cardW);
    const lo = outward < 0 ? -r2 : -1;
    const ls = lineSearch(cg, w, h, vertical, a.pos, a.t, from, to, lo, lo + r2 + 1, 0.004, 0.002, outward);
    return refineEdge(vertical ? gx : gy, w, h, vertical, ls.pos, ls.t, from, to, 2);
  };
  const lines = {
    left: edge(true, q[0], q[3], -1),
    right: edge(true, q[1], q[2], 1),
    top: edge(false, q[0], q[1], -1),
    bottom: edge(false, q[3], q[2], 1),
  };
  const corners = [
    intersect(lines.top, lines.left),
    intersect(lines.top, lines.right),
    intersect(lines.bottom, lines.right),
    intersect(lines.bottom, lines.left),
  ].map(toSrc);
  return { corners, found: true, debug: { coarse: coarse.best, first: coarse.first, lines } };
}

const SIDES = ['left', 'right', 'top', 'bottom'];
const SCAN_MM = 7; // how far in from the edge to look
const SKIP_ENDS_MM = 6; // ignore the rounded corners
const MAX_BORDER_MM = 5;
const MIN_BORDER_MM = 0.5;
export const DEFAULT_BORDER_MM = 3;

/**
 * On the flattened card (S px per mm, card inset by m px), find the straight lines that run
 * parallel to each edge and pick the innermost one as "where the art begins".
 * Returns { left|right|top|bottom: { mm, candidates: [mm...] } }.
 */
export function detectBorders(flat, S, m) {
  const d = flat.data;
  const fw = flat.width;
  const D = Math.round(SCAN_MM * S) + 2;
  const out = {};
  for (const side of SIDES) {
    const vertical = side === 'left' || side === 'right';
    const len = (vertical ? CARD_H : CARD_W) * S;
    const a0 = Math.round(SKIP_ENDS_MM * S);
    const n = len - 2 * a0;
    // strip[c][i * D + depth]: colour along the side (i) and inward from the edge (depth)
    const strip = [new Float32Array(n * D), new Float32Array(n * D), new Float32Array(n * D)];
    for (let i = 0; i < n; i++) {
      for (let dep = 0; dep < D; dep++) {
        let x, y;
        if (side === 'left') { x = m + dep; y = m + a0 + i; }
        else if (side === 'right') { x = m + CARD_W * S - dep; y = m + a0 + i; }
        else if (side === 'top') { x = m + a0 + i; y = m + dep; }
        else { x = m + a0 + i; y = m + CARD_H * S - dep; }
        const p = (y * fw + x) * 4;
        strip[0][i * D + dep] = d[p];
        strip[1][i * D + dep] = d[p + 1];
        strip[2][i * D + dep] = d[p + 2];
      }
    }
    // average a few pixels along the side, then take the gradient across it
    const HW = 4;
    const rows = [];
    for (let i = HW; i < n - HW; i += 2) rows.push(i);
    const G = new Float32Array(rows.length * D);
    const acc = new Float32Array(D);
    rows.forEach((i, ri) => {
      const g2 = new Float32Array(D);
      for (const c of strip) {
        acc.fill(0);
        for (let k = -HW; k <= HW; k++) {
          const o = (i + k) * D;
          for (let dep = 0; dep < D; dep++) acc[dep] += c[o + dep];
        }
        for (let dep = 1; dep < D - 1; dep++) {
          const v = (acc[dep + 1] - acc[dep - 1]) / (2 * HW + 1);
          g2[dep] += v * v;
        }
      }
      for (let dep = 0; dep < D; dep++) G[ri * D + dep] = Math.sqrt(g2[dep]);
    });
    // a real frame line shows up on most of the side: take the median along the side
    const Q = new Float32Array(D);
    const col = new Float32Array(rows.length);
    for (let dep = 1; dep < D - 1; dep++) {
      for (let ri = 0; ri < rows.length; ri++) col[ri] = G[ri * D + dep];
      const s = Float32Array.from(col).sort();
      Q[dep] = s[s.length >> 1];
    }
    const peaks = findPeaks(Q, Math.round(MIN_BORDER_MM * S), Math.round(6 * S), 0.25 * S, 10);
    const max = peaks.length ? peaks[0].val : 0;
    out[side] = {
      peaks: peaks
        .filter((p) => p.val >= 0.25 * max)
        .map((p) => ({ mm: p.pos / S, val: p.val / max }))
        .sort((a, b) => a.mm - b.mm),
      profile: Array.from(Q),
    };
  }
  pickArtStart(out);
  return out;
}

/**
 * Choose, on each side, which detected line is where the art begins.
 *
 * 1. Multi-line frames. A frame draws the same sequence of lines inside every edge (for example
 *    silver band, black line, thin silver line, then art), only shifted by the centering. If the
 *    same line spacings turn up on all four sides, the innermost line of that shared pattern is
 *    where the art begins.
 * 2. Plain borders. Otherwise the border ends at the first solid line in from each edge. Each
 *    side is judged on its own, so a genuinely lopsided card is reported as lopsided.
 */
function pickArtStart(out) {
  const TOL = 0.22; // mm
  const FRAME_MIN = 0.35; // faint lines are too unreliable to build a pattern from
  const opts = SIDES.map((s) => {
    const ok = out[s].peaks.filter((p) => p.mm <= MAX_BORDER_MM);
    const solid = ok.filter((p) => p.mm >= 1); // anything nearer the edge is usually a rim or shadow
    return solid.length ? solid : ok;
  });
  const offsets = (side, a) =>
    out[side].peaks.filter((p) => p.val >= FRAME_MIN).map((p) => a.mm - p.mm).filter((o) => o >= 0.4 && o <= 2.5);
  const closeness = (o, B) => {
    let best = 0;
    for (const b of B) best = Math.max(best, 1 - Math.abs(o - b) / TOL);
    return best;
  };

  // 1. shared frame pattern
  let best = null;
  const choice = [];
  const walk = (i) => {
    if (i === SIDES.length) {
      const offs = choice.map((c, k) => offsets(SIDES[k], c));
      let lines = 0;
      let fit = 0;
      for (const o of offs[0]) {
        const c = [closeness(o, offs[1]), closeness(o, offs[2]), closeness(o, offs[3])];
        if (c.every((v) => v > 0)) {
          lines++;
          fit += (c[0] + c[1] + c[2]) / 3;
        }
      }
      if (!lines) return;
      // A real frame's lines are the strongest ones on the card's edge. If the strongest line on
      // most sides is not part of the pattern, the "pattern" is a coincidence among faint lines.
      const matched = offs[0].filter((o) => [1, 2, 3].every((k) => closeness(o, offs[k]) > 0));
      let anchored = 0;
      choice.forEach((c, k) => {
        const top = out[SIDES[k]].peaks.reduce((a, b) => (b.val > a.val ? b : a));
        const d = c.mm - top.mm;
        if (Math.abs(d) < 0.05 || matched.some((o) => Math.abs(o - d) <= TOL)) anchored++;
      });
      if (anchored < 3) return;
      // and a multi-line frame has at least two solid lines per side, not one line plus noise
      let multi = 0;
      choice.forEach((c, k) => {
        const solid = out[SIDES[k]].peaks.filter((p) => p.val >= 0.6 && p.mm <= c.mm + 0.05 && p.mm >= c.mm - 2.5);
        if (solid.length >= 2) multi++;
      });
      if (multi < 3) return;
      const depth = choice.reduce((t, c) => t + c.mm, 0);
      const better =
        !best ||
        lines > best.lines ||
        (lines === best.lines && (fit > best.fit * 1.05 || (fit > best.fit * 0.95 && depth > best.depth)));
      if (better) best = { lines, fit, depth, choice: [...choice] };
      return;
    }
    for (const c of opts[i]) {
      if (c.val < FRAME_MIN) continue;
      choice[i] = c;
      walk(i + 1);
    }
  };
  if (opts.every((o) => o.length)) walk(0);

  // 2. otherwise: the first solid line in from the edge
  const firsts = opts.map((o) => o.find((p) => p.val >= 0.6) || o[0]);
  if (!best) {
    // A side that comes out worse than about 70/30 against its opposite is more often a stray
    // line (glare, a holder's edge) than a miscut. Take a solid line near the opposite side's
    // value if there is one; a genuinely miscut card has no such line and is left alone.
    for (const [a, b] of [[0, 1], [1, 0], [2, 3], [3, 2]]) {
      const fa = firsts[a];
      const fb = firsts[b];
      if (!fa || !fb || fb.mm / fa.mm < 2.2) continue;
      const near = opts[a].filter((p) => p.val >= 0.6 && Math.abs(p.mm / fb.mm - 1) <= 0.25);
      if (near.length) firsts[a] = near.reduce((x, y) => (Math.abs(y.mm - fb.mm) < Math.abs(x.mm - fb.mm) ? y : x));
    }
  }
  SIDES.forEach((s, k) => {
    const c = best ? best.choice[k] : firsts[k];
    out[s].mm = c ? c.mm : DEFAULT_BORDER_MM;
    out[s].found = !!c;
    out[s].candidates = out[s].peaks.map((p) => p.mm);
    out[s].pattern = !!best;
  });
}
