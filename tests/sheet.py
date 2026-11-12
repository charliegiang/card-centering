"""Draw the detector's output for inspection: the photo with the detected outline next to the
flattened card with its border lines. Usage: python tests/sheet.py [synth|real]"""
import json, os, struct, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
L = os.path.join(HERE, 'local')
S, M = 16, 32


def raw(p):
    b = open(p, 'rb').read()
    w, h = struct.unpack('<II', b[:8])
    return Image.frombytes('RGBA', (w, h), b[8:]).convert('RGB')


s = sys.argv[1] if len(sys.argv) > 1 else 'synth'
for r in json.load(open(os.path.join(L, 'out', 'results-' + s + '.json'))):
    ph = raw(os.path.join(L, 'raw', r['key'] + '.rgba'))
    d = ImageDraw.Draw(ph)
    c = [tuple(p) for p in r['corners']]
    d.line(c + [c[0]], fill=(0, 255, 0), width=max(2, ph.width // 400))
    fl = raw(os.path.join(L, 'out', r['key'] + '.flat.rgba'))
    d = ImageDraw.Draw(fl)
    W, H = 63 * S, 88 * S
    mm = r['mm']
    d.rectangle((M, M, M + W, M + H), outline=(0, 255, 0), width=2)
    for x in (M + mm['left'] * S, M + W - mm['right'] * S):
        d.line((x, M, x, M + H), fill=(255, 0, 255), width=2)
    for y in (M + mm['top'] * S, M + H - mm['bottom'] * S):
        d.line((M, y, M + W, y), fill=(255, 0, 255), width=2)
    hh = 1100
    ph = ph.resize((round(ph.width * hh / ph.height), hh))
    fl = fl.resize((round(fl.width * hh / fl.height), hh))
    t = Image.new('RGB', (ph.width + fl.width + 10, hh), 'white')
    t.paste(ph, (0, 0))
    t.paste(fl, (ph.width + 10, 0))
    t.save(os.path.join(L, 'out', r['key'] + '.png'))
print('ok')
