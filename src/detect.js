// Automatic detection: the card's four edges in a photo, and the border lines on the flattened card.
import { intersect } from './geometry.js';

export const CARD_W = 63; // mm, standard trading card
export const CARD_H = 88;
const ASPECT = CARD_W / CARD_H;

// Gradient units: colour magnitude of a central difference on 0-255 values.
const NOISE_FLOOR = 8; // below this a gradient is treated as texture noise
const CLIP = 30; // above this every edge counts the same, so faint-but-long edges are not drowned out

function workImage(srcCanvas, maxDim) {
  const k = Math.min(1, maxDim / Math.max(srcCanvas.width, srcCanvas.height));
  const w = Math.round(srcCanvas.width * k);
  const h = Math.round(srcCanvas.height * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcCanvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const ch = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    ch[0][i] = d[p];
    ch[1][i] = d[p + 1];
    ch[2][i] = d[p + 2];
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

function clipped(g) {
  const o = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) {
    const v = g[i] - NOISE_FLOOR;
    o[i] = v <= 0 ? 0 : v > CLIP - NOISE_FLOOR ? CLIP - NOISE_FLOOR : v;
  }
  return o;
}

/**
 * Sum edge evidence along a family of parallel lines.
 * vertical: lines x = x0 + t*(y - h/2), profile indexed by x0.
 * horizontal: lines y = y0 + t*(x - w/2), profile indexed by y0.
 */
function profile(g, w, h, t, vertical, step) {
  const n = vertical ? w : h;
  const P = new Float32Array(n);
  if (vertical) {
    for (let y = 1; y < h - 1; y += step) {
      const sh = t * (y - h / 2);
      for (let x = 1; x < w - 1; x++) {
        const v = g[y * w + x];
        if (!v) continue;
        const u = x - sh;
        const i = Math.floor(u);
        if (i < 0 || i >= n - 1) continue;
        const f = u - i;
        P[i] += v * (1 - f);
        P[i + 1] += v * f;
      }
    }
  } else {
    for (let x = 1; x < w - 1; x += step) {
      const sh = t * (x - w / 2);
      for (let y = 1; y < h - 1; y++) {
        const v = g[y * w + x];
        if (!v) continue;
        const u = y - sh;
        const i = Math.floor(u);
        if (i < 0 || i >= n - 1) continue;
        const f = u - i;
        P[i] += v * (1 - f);
        P[i + 1] += v * f;
      }
    }
  }
  return P;
}

function sharpness(P) {
  let s = 0;
  let s2 = 0;
  for (const v of P) {
    s += v;
    s2 += v * v;
  }
  return s ? s2 / (s * s) : 0;
}

/** Tilt at which straight lines in the photo line up best (the card's edges and frame lines). */
function bestTilt(g, w, h, vertical) {
  let best = 0;
  let bestS = -1;
  for (let t = -0.15; t <= 0.1501; t += 0.005) {
    const s = sharpness(profile(g, w, h, t, vertical, 2));
    if (s > bestS) {
      bestS = s;
      best = t;
    }
  }
  const c = best;
  for (let t = c - 0.004; t <= c + 0.0041; t += 0.001) {
    const s = sharpness(profile(g, w, h, t, vertical, 1));
    if (s > bestS) {
      bestS = s;
      best = t;
    }
  }
  return best;
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

/** Largest rectangle with card proportions whose four sides all sit on strong lines. */
function chooseRect(vp, hp, w, h) {
  const pick = (peaks, frac) => {
    const max = peaks.length ? peaks[0].val : 0;
    return peaks.filter((p) => p.val >= frac * max).sort((a, b) => a.pos - b.pos);
  };
  for (const [frac, tol] of [
    [0.35, 0.03],
    [0.25, 0.04],
    [0.15, 0.06],
  ]) {
    const V = pick(vp, frac);
    const Hs = pick(hp, frac);
    let best = null;
    for (let a = 0; a < V.length; a++) {
      for (let b = a + 1; b < V.length; b++) {
        const wd = V[b].pos - V[a].pos;
        if (wd < 0.2 * w) continue;
        for (let c = 0; c < Hs.length; c++) {
          for (let d = c + 1; d < Hs.length; d++) {
            const ht = Hs[d].pos - Hs[c].pos;
            if (ht < 0.2 * h) continue;
            if (Math.abs(wd / ht / ASPECT - 1) > tol) continue;
            if (!best || wd * ht > best.area) {
              best = { l: V[a].pos, r: V[b].pos, t: Hs[c].pos, b: Hs[d].pos, area: wd * ht };
            }
          }
        }
      }
    }
    if (best) return best;
  }
  return null;
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
 * Local line search around a coarse edge: try small shifts and tilts and keep the line with the
 * most (clipped) edge evidence along it. Lets each edge have its own tilt, as perspective requires.
 */
function lineSearch(cg, w, h, vertical, pos0, t0, from, to) {
  const len = vertical ? h : w;
  const lim = vertical ? w : h;
  let best = { pos: pos0, t: t0, score: -1 };
  for (let dt = -0.012; dt <= 0.01201; dt += 0.002) {
    for (let dp = -1.5; dp <= 1.501; dp += 0.25) {
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
      if (score > best.score) best = { pos: pos0 + dp, t: t0 + dt, score };
    }
  }
  return best;
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

/**
 * Find the card in a photo. Returns corners [TL, TR, BR, BL] in source-pixel coordinates,
 * plus `found: false` when it had to fall back to a guess.
 */
export function detectCard(srcCanvas) {
  const { ch, w, h, k } = workImage(srcCanvas, 1000);
  const b = ch.map((c) => blur(c, w, h));
  const { gx, gy } = gradients(b, w, h);
  const cgx = clipped(gx);
  const cgy = clipped(gy);
  const tv = bestTilt(cgx, w, h, true);
  const th = bestTilt(cgy, w, h, false);
  const vp = findPeaks(profile(cgx, w, h, tv, true, 1), 3, w - 3, 2.5, 16);
  const hp = findPeaks(profile(cgy, w, h, th, false, 1), 3, h - 3, 2.5, 16);
  let rect = chooseRect(vp, hp, w, h);
  const found = !!rect;
  if (!rect) {
    const ht = 0.8 * h;
    const wd = Math.min(0.8 * w, ht * ASPECT);
    rect = { l: (w - wd) / 2, r: (w + wd) / 2, t: (h - wd / ASPECT) / 2, b: (h + wd / ASPECT) / 2 };
  }
  let lines;
  if (found) {
    const wd = rect.r - rect.l;
    const ht = rect.b - rect.t;
    const R = 2;
    const y0 = rect.t + 0.1 * ht;
    const y1 = rect.b - 0.1 * ht;
    const x0 = rect.l + 0.12 * wd;
    const x1 = rect.r - 0.12 * wd;
    const edge = (g, cg, vertical, pos, t, from, to) => {
      const ls = lineSearch(cg, w, h, vertical, pos, t, from, to);
      return refineEdge(g, w, h, vertical, ls.pos, ls.t, from, to, R);
    };
    lines = {
      left: edge(gx, cgx, true, rect.l, tv, y0, y1),
      right: edge(gx, cgx, true, rect.r, tv, y0, y1),
      top: edge(gy, cgy, false, rect.t, th, x0, x1),
      bottom: edge(gy, cgy, false, rect.b, th, x0, x1),
    };
  } else {
    lines = { left: [0, rect.l], right: [0, rect.r], top: [0, rect.t], bottom: [0, rect.b] };
  }
  const toSrc = ([x, y]) => [(x + 0.5) / k - 0.5, (y + 0.5) / k - 0.5];
  const corners = [
    intersect(lines.top, lines.left),
    intersect(lines.top, lines.right),
    intersect(lines.bottom, lines.right),
    intersect(lines.bottom, lines.left),
  ].map(toSrc);
  return { corners, found, debug: { tv, th, vp, hp, rect, w, h, k } };
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
 * A card frame draws the same sequence of lines inside every edge (for example: silver band,
 * black line, thin silver line, then art), only shifted by the centering. So choose, on each
 * side, the line whose preceding lines are spaced the same way as on the other sides. With a
 * plain one-line border nothing matches and the strongest line on each side wins.
 */
function pickArtStart(out) {
  const TOL = 0.15; // mm
  const opts = SIDES.map((s) => out[s].peaks.filter((p) => p.mm <= MAX_BORDER_MM));
  const offsets = (side, a) => out[side].peaks.filter((p) => p.mm < a.mm - 0.2).map((p) => a.mm - p.mm);
  // closeness-weighted count of spacings the two sides share
  const matches = (A, B) => {
    let n = 0;
    const used = new Set();
    for (const a of A) {
      let j = -1;
      let dj = TOL;
      B.forEach((b, k) => {
        const d = Math.abs(a - b);
        if (!used.has(k) && d <= dj) {
          dj = d;
          j = k;
        }
      });
      if (j >= 0) {
        used.add(j);
        n += 1 - dj / TOL;
      }
    }
    return n;
  };
  let best = null;
  const choice = [];
  const walk = (i) => {
    if (i === SIDES.length) {
      const offs = choice.map((c, k) => (c ? offsets(SIDES[k], c) : []));
      let score = 0;
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) score += matches(offs[a], offs[b]);
      const strength = choice.reduce((t, c) => t + (c ? c.val : 0), 0);
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && strength > best.strength)) {
        best = { score, strength, choice: [...choice] };
      }
      return;
    }
    const list = opts[i].length ? opts[i] : [null];
    for (const c of list) {
      choice[i] = c;
      walk(i + 1);
    }
  };
  walk(0);
  SIDES.forEach((s, k) => {
    const c = best.choice[k];
    out[s].mm = c ? c.mm : DEFAULT_BORDER_MM;
    out[s].found = !!c;
    out[s].candidates = out[s].peaks.map((p) => p.mm);
  });
}
