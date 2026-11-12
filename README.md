# Card Centering

Upload a photo of a trading card and get its centering: left/right and top/bottom ratios, plus each border in millimetres.

Everything runs in the browser. The photo is never uploaded anywhere, and there is nothing to install.

## Run it

```bash
python -m http.server 5178
```

Then open http://localhost:5178. Any static file server works; the page just needs to be served over HTTP because it uses JavaScript modules.

Upload, drop or paste a photo, or press **Try the sample**.

## What it does

1. **Finds the card.** On a small copy of the photo it finds straight lines at any tilt, then picks the four that form the best-supported quadrilateral with standard card proportions (63 × 88 mm), allowing for perspective. Each edge is then refined on a larger copy. Where several parallel lines sit close together, it takes the outermost one that is still reasonably strong, since a card's physical edge is often fainter than the print just inside it.
2. **Flattens it.** The four corners are mapped to a true rectangle, so a tilted or angled photo is measured as if it were shot straight on.
3. **Finds where the art begins.** On each side it finds the lines that run parallel to the edge.
   - If the same line spacings show up on all four sides (a multi-line frame such as silver band, black line, thin silver line, then art), the innermost line of that shared pattern is used.
   - Otherwise the border ends at the first solid line in from each edge. Each side is judged on its own, so a lopsided card is reported as lopsided. The one exception: if a side comes out worse than about 70/30 and there is another solid line close to the opposite side's value, that line is used, since a stray line is far more common than a miscut that bad.
4. **Reports centering.** Border = card edge to where the art begins. Left/right and top/bottom are each given as a percentage split.

If a detection is off, drag it: the green corners on the photo, or the pink lines on the flattened card. Hold **Shift** while dragging for fine moves. The numbers update live. **Re-detect** starts over.

## Getting good numbers

- Take the card out of its sleeve, toploader or case if you can.
- Shoot roughly straight on with the card upright, and leave some background visible all the way around it.
- Use a plain, matte background that contrasts with the card's border.
- Avoid glare on the borders, especially on foil cards.
- Use the full-resolution photo. On a 1000 px photo a border is only 20–30 px wide, so one pixel is worth about a point of centering.

## How well it works

Checked on 7 synthetic photos with known answers and 13 real photos (12 eBay listing photos plus the sample), judged by eye from the overlays.

- **Raw card on a plain background:** works, including at a strong angle. On the synthetic set corners land within a pixel on plain dark backgrounds, and a deliberately miscut test card is reported with the right lopsided borders.
- **Toploader or magnetic case lying flat:** worked on the two test photos; the outline lands on the card, not the holder.
- **Two photos of the same card:** agree within about 4 points (two pairs tested).
- **Silver or dark card on a light background:** the outline can land a few pixels inside the true edge.
- **Card with a faint halo, shadow or mat around it:** the outline can land slightly outside the card.
- **Sleeve on a stand, card cropped by the photo, busy patterned backgrounds:** unreliable.

Always look at the overlay before trusting a number. The lines are draggable for exactly this reason.

Other limits: expects the card upright (portrait), assumes a standard 63 × 88 mm card, and the grade line shows commonly quoted PSA front-centering guidelines for centering only. Check the grader's current standards; it says nothing about corners, edges or surface.

## Tests

Test photos are kept out of the repo (`tests/local/` is git-ignored).

```bash
python tests/make_photos.py
```

builds the synthetic set from public card scans. Add your own photos by listing them in `tests/local/list.json` under `real`, then:

```bash
python tests/prep.py
```

```bash
node tests/run.mjs real
```

```bash
python tests/sheet.py real
```

`python tests/overview.py real` tiles them into one image, and `node tests/debug.mjs <name>` prints how the outline was chosen. `run.mjs` prints the numbers for each photo (`synth` or `real`), and `sheet.py` writes an overlay image per photo to `tests/local/out/` for checking by eye. `tests/run.html?set=real` shows the same thing in the browser.

## Layout

- `index.html`, `style.css` — the page
- `src/app.js` — UI: upload, drawing, dragging, results
- `src/detect.js` — card and border detection (no browser APIs, so it also runs in Node)
- `src/geometry.js` — homography and perspective warp
- `samples/` — sample photo
- `tests/` — test-photo generator and batch harness
