// Small geometry helpers: linear solve, homography, perspective warp.

export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('singular system');
    for (let k = c; k <= n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row) => row[n]);
}

/** 3x3 homography (row-major, 9 numbers) mapping the 4 `src` points onto the 4 `dst` points. */
export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solveLinear(A, b), 1];
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/**
 * Perspective-warp `src` (ImageData) into a new outW x outH ImageData.
 * H maps output pixel coordinates to source pixel coordinates. Bilinear sampling.
 */
export function warp(src, H, outW, outH) {
  const out = new ImageData(outW, outH);
  const sd = src.data;
  const od = out.data;
  const sw = src.width;
  const sh = src.height;
  for (let y = 0; y < outH; y++) {
    let nx = H[1] * y + H[2];
    let ny = H[4] * y + H[5];
    let nw = H[7] * y + H[8];
    let o = y * outW * 4;
    for (let x = 0; x < outW; x++, o += 4, nx += H[0], ny += H[3], nw += H[6]) {
      let sx = nx / nw;
      let sy = ny / nw;
      if (sx < 0) sx = 0;
      else if (sx > sw - 1.001) sx = sw - 1.001;
      if (sy < 0) sy = 0;
      else if (sy > sh - 1.001) sy = sh - 1.001;
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const i = (y0 * sw + x0) * 4;
      const j = i + sw * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      od[o] = sd[i] * w00 + sd[i + 4] * w10 + sd[j] * w01 + sd[j + 4] * w11;
      od[o + 1] = sd[i + 1] * w00 + sd[i + 5] * w10 + sd[j + 1] * w01 + sd[j + 5] * w11;
      od[o + 2] = sd[i + 2] * w00 + sd[i + 6] * w10 + sd[j + 2] * w01 + sd[j + 6] * w11;
      od[o + 3] = 255;
    }
  }
  return out;
}

/** Intersection of a near-horizontal line y = a*x + b with a near-vertical line x = c*y + d. */
export function intersect(hLine, vLine) {
  const [a, b] = hLine;
  const [c, d] = vLine;
  const y = (a * d + b) / (1 - a * c);
  return [c * y + d, y];
}
