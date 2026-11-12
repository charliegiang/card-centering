// node tests/debug.mjs <name filter>  — print the coarse quad the card finder settled on
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectCard } from '../src/detect.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const L = path.join(here, 'local');
const filter = process.argv[2] || '';
const all = JSON.parse(fs.readFileSync(path.join(L, 'list.json'), 'utf8'));
for (const item of [...all.real, ...all.synth].filter((e) => e.name.includes(filter))) {
  const buf = fs.readFileSync(path.join(L, 'raw', item.name.replaceAll(' ', '_') + '.rgba'));
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  const src = { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, width * height * 4), width, height };
  const det = detectCard(src);
  const c = det.debug.coarse;
  console.log(item.name, width + 'x' + height);
  console.log('  coarse score', c.score.toFixed(2), 'support L R T B', c.sup.map((v) => v.toFixed(2)).join(' '), 'aspect dev', (100 * c.dev).toFixed(1) + '%', 'area', c.frac.toFixed(2), c.note || '');
  if (det.debug.first) console.log('  first pick: score', det.debug.first.score.toFixed(2), 'support', det.debug.first.sup.map((v) => v.toFixed(2)).join(' '), 'dev', (100 * det.debug.first.dev).toFixed(1) + '%');
  console.log('  corners', det.corners.map((p) => p.map((v) => Math.round(v)).join(',')).join('  '));
}
