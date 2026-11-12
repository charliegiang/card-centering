"""Build synthetic test photos: clean card scans placed on backgrounds with rotation,
perspective, blur and noise. The true corner positions are written to truth.json.

Scans are fetched from the public Pokemon TCG image API and kept out of the repo
(tests/local/ is git-ignored).

    python tests/make_photos.py
"""
import json, os, urllib.request
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'local')
W, H = 1200, 1600
CARD_W = 620
CARD_H = round(CARD_W * 88 / 63)

# name, scan id, background, rotation (deg), corner jitter (px, TL TR BR BL), crop (l, t, r, b px of the scan)
CASES = [
    ('base-charizard-dark', 'base1/4', 'dark', 1.5, [(0, 0)] * 4, (0, 0, 0, 0)),
    ('sv-charizard-ex-wood', 'sv3pt5/6', 'wood', -3.0, [(6, 4), (-5, 0), (0, 0), (3, -4)], (0, 0, 0, 0)),
    ('snorlax-v-light', 'swsh1/141', 'light', 0.5, [(0, 0)] * 4, (0, 0, 0, 0)),
    ('venusaur-ex-busy', 'xy1/1', 'busy', 4.0, [(0, 0), (-8, 6), (0, 0), (8, -6)], (0, 0, 0, 0)),
    ('tag-team-felt', 'sm9/170', 'felt', -2.0, [(0, 0)] * 4, (0, 0, 0, 0)),
    ('sv-charizard-ex-light', 'sv3pt5/6', 'light', 1.0, [(0, 0)] * 4, (0, 0, 0, 0)),
    ('base-charizard-miscut', 'base1/4', 'felt', -1.0, [(0, 0)] * 4, (10, 0, 0, 8)),
]


def fetch(scan_id):
    path = os.path.join(OUT, scan_id.replace('/', '_') + '.png')
    if not os.path.exists(path):
        req = urllib.request.Request(f'https://images.pokemontcg.io/{scan_id}_hires.png', headers={'User-Agent': 'card-centering-test/0.1'})
        with urllib.request.urlopen(req) as r, open(path, 'wb') as f:
            f.write(r.read())
    return Image.open(path).convert('RGBA')


def background(kind, rng):
    if kind == 'dark':
        a = 38 + rng.normal(0, 5, (H, W, 1)) + np.zeros((H, W, 3))
    elif kind == 'light':
        a = np.array([232, 230, 224]) + rng.normal(0, 4, (H, W, 1))
    elif kind == 'felt':
        a = np.array([28, 82, 48]) + rng.normal(0, 9, (H, W, 1))
    elif kind == 'wood':
        x = np.arange(W)[None, :, None]
        y = np.arange(H)[:, None, None]
        grain = 14 * np.sin(x / 9.0 + 3 * np.sin(y / 170.0)) + 8 * np.sin(x / 31.0)
        a = np.array([142, 98, 60]) + grain + rng.normal(0, 4, (H, W, 1))
    else:  # busy: soft colour blobs, like a printed playmat
        small = rng.integers(0, 255, (H // 40, W // 40, 3)).astype(np.uint8)
        a = np.asarray(Image.fromarray(small).resize((W, H), Image.BICUBIC)).astype(float)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert('RGB')


def homog(src, dst):
    A, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return np.linalg.solve(np.array(A, float), np.array(b, float))


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.default_rng(7)
    truth = {}
    for name, scan_id, bg_kind, rot, jitter, crop in CASES:
        scan = fetch(scan_id)
        l, t, r, b = crop
        scan = scan.crop((l, t, scan.width - r, scan.height - b))
        sw, sh = scan.size
        cx, cy = W / 2, H / 2
        th = np.deg2rad(rot)
        base = [(-CARD_W / 2, -CARD_H / 2), (CARD_W / 2, -CARD_H / 2), (CARD_W / 2, CARD_H / 2), (-CARD_W / 2, CARD_H / 2)]
        corners = []
        for (x, y), (jx, jy) in zip(base, jitter):
            corners.append((cx + x * np.cos(th) - y * np.sin(th) + jx, cy + x * np.sin(th) + y * np.cos(th) + jy))
        # PIL wants output -> input coefficients; map corner-origin coordinates
        coef = homog(corners, [(0, 0), (sw, 0), (sw, sh), (0, sh)])
        card = scan.transform((W, H), Image.PERSPECTIVE, tuple(coef), Image.BICUBIC)
        # the transform repeats edge pixels outside the card: mask to the true quad via alpha
        mask = Image.new('L', scan.size, 255).transform((W, H), Image.PERSPECTIVE, tuple(coef), Image.BICUBIC, fillcolor=0)
        alpha = Image.fromarray((np.asarray(card.split()[3]).astype(float) * np.asarray(mask) / 255).astype(np.uint8))
        bg = background(bg_kind, rng)
        shadow = alpha.filter(ImageFilter.GaussianBlur(6)).point(lambda v: int(v * 0.45))
        bg.paste((0, 0, 0), (5, 7), shadow)
        bg.paste(card.convert('RGB'), (0, 0), alpha)
        img = bg.filter(ImageFilter.GaussianBlur(0.8))
        a = np.asarray(img).astype(float) + rng.normal(0, 3, (H, W, 3))
        Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name + '.jpg'), quality=88)
        # corners as pixel-centre coordinates, the convention the app uses
        truth[name] = [[round(x - 0.5, 2), round(y - 0.5, 2)] for x, y in corners]
        print('wrote', name)
    json.dump(truth, open(os.path.join(OUT, 'truth.json'), 'w'), indent=1)
    # list.json drives the test harness; keep any real photos already listed there
    lp = os.path.join(OUT, 'list.json')
    lst = json.load(open(lp)) if os.path.exists(lp) else {'real': []}
    lst['synth'] = [{'url': 'local/' + k + '.jpg', 'name': k, 'truth': v} for k, v in truth.items()]
    json.dump(lst, open(lp, 'w'), indent=1)


if __name__ == '__main__':
    main()
