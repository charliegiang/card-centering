// Command-line batch test: node tests/run.mjs [synth|real] [name filter]
// Needs tests/local/list.json and raw images from `python tests/prep.py`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homography, warp } from '../src/geometry.js';
import { detectCard, detectBorders, CARD_W, CARD_H } from '../src/detect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = path.join(here, 'local');
const S = 16;
const M = 2 * S;
const FW = CARD_W * S + 2 * M;
const FH = CARD_H * S + 2 * M;
const SIDES = ['left', 'right', 'top', 'bottom'];
const [set = 'synth', filter = ''] = process.argv.slice(2);
const list = JSON.parse(fs.readFileSync(path.join(L, 'list.json'), 'utf8'))[set].filter((e) => e.name.includes(filter));
fs.mkdirSync(path.join(L, 'out'), { recursive: true });
const results = [];
for (const item of list) {
  const key = item.name.replaceAll(' ', '_');
  const buf = fs.readFileSync(path.join(L, 'raw', key + '.rgba'));
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  const src = { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, width * height * 4), width, height };
  const t0 = performance.now();
  const det = detectCard(src);
  const dst = [[M, M], [M + CARD_W * S, M], [M + CARD_W * S, M + CARD_H * S], [M, M + CARD_H * S]];
  const flat = warp(src, homography(dst, det.corners), FW, FH);
  const b = detectBorders(flat, S, M);
  const ms = Math.round(performance.now() - t0);
  const head = Buffer.alloc(8);
  head.writeUInt32LE(FW, 0);
  head.writeUInt32LE(FH, 4);
  fs.writeFileSync(path.join(L, 'out', key + '.flat.rgba'), Buffer.concat([head, Buffer.from(flat.data.buffer)]));
  const mm = Object.fromEntries(SIDES.map((s) => [s, +b[s].mm.toFixed(2)]));
  const r = {
    name: item.name,
    key,
    found: det.found,
    score: det.debug.coarse ? +det.debug.coarse.score.toFixed(2) : 0,
    corners: det.corners.map((c) => c.map((v) => +v.toFixed(1))),
    mm,
    lr: +((100 * mm.left) / (mm.left + mm.right)).toFixed(1),
    tb: +((100 * mm.top) / (mm.top + mm.bottom)).toFixed(1),
    peaks: Object.fromEntries(SIDES.map((s) => [s, b[s].peaks.map((p) => p.mm.toFixed(2) + ':' + p.val.toFixed(2)).join(' ')])),
    ms,
  };
  if (item.truth) {
    r.cornerErr = +Math.max(...det.corners.map(([x, y], i) => Math.hypot(x - item.truth[i][0], y - item.truth[i][1]))).toFixed(1);
  }
  results.push(r);
  console.log(
    r.name.padEnd(26) + ' found=' + r.found + ' score=' + r.score + '  L/R ' + r.lr + '/' + (100 - r.lr).toFixed(1) + '  T/B ' + r.tb + '/' + (100 - r.tb).toFixed(1) +
      '  mm L' + mm.left + ' R' + mm.right + ' T' + mm.top + ' B' + mm.bottom + (item.truth ? '  cornerErr ' + r.cornerErr : '') + '  ' + ms + 'ms',
  );
}
fs.writeFileSync(path.join(L, 'out', 'results-' + set + '.json'), JSON.stringify(results, null, 1));
