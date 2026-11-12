"""Convert the test photos listed in tests/local/list.json to raw RGBA so the Node harness can read them."""
import json, os, struct
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
L = os.path.join(HERE, 'local')
os.makedirs(os.path.join(L, 'raw'), exist_ok=True)
lst = json.load(open(os.path.join(L, 'list.json')))
for group in lst.values():
    for item in group:
        im = Image.open(os.path.join(HERE, item['url'])).convert('RGBA')
        k = min(1, 2600 / max(im.size))
        if k < 1:
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        with open(os.path.join(L, 'raw', item['name'].replace(' ', '_') + '.rgba'), 'wb') as f:
            f.write(struct.pack('<II', *im.size))
            f.write(im.tobytes())
print('ok')
