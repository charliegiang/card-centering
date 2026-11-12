"""Tile every result sheet into one overview image per set: python tests/overview.py [synth|real]"""
import json, os, sys
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
O = os.path.join(HERE, 'local', 'out')
s = sys.argv[1] if len(sys.argv) > 1 else 'real'
rs = json.load(open(os.path.join(O, 'results-' + s + '.json')))
cols, cw, ch = 4, 600, 450
rows = (len(rs) + cols - 1) // cols
t = Image.new('RGB', (cols * cw, rows * ch), (20, 22, 28))
d = ImageDraw.Draw(t)
for i, r in enumerate(rs):
    im = Image.open(os.path.join(O, r['key'] + '.png'))
    im.thumbnail((cw - 8, ch - 30))
    x, y = (i % cols) * cw + 4, (i // cols) * ch + 4
    t.paste(im, (x, y + 22))
    d.text((x, y + 4), '%s   L/R %.1f/%.1f   T/B %.1f/%.1f' % (r['name'], r['lr'], 100 - r['lr'], r['tb'], 100 - r['tb']), fill=(255, 255, 255))
t.save(os.path.join(O, 'overview-' + s + '.png'))
print('ok')
