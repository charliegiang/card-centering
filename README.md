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

1. **Finds the card.** It looks for long straight edges in the photo and picks the largest rectangle with standard card proportions (63 × 88 mm) whose four sides all sit on one.
2. **Flattens it.** The four corners are mapped to a true rectangle, so a tilted or slightly angled photo is measured as if it were shot straight on.
3. **Finds where the art begins.** On each side it finds the frame lines that run parallel to the edge. A frame draws the same sequence of lines inside every edge (for example silver band, black line, thin silver line, then art), so it picks the line on each side whose spacing pattern matches the other three sides. For a plain one-line border it takes the strongest line.
4. **Reports centering.** Border = card edge to where the art begins. Left/right and top/bottom are each given as a percentage split.

If a detection is off, drag it: the green corners on the photo, or the pink lines on the flattened card. Hold **Shift** while dragging for fine moves. The numbers update live. **Re-detect** starts over.

## Getting good numbers

- Shoot straight on with the card upright.
- Use a plain, dark, matte background. A card edge against a light or busy background is the main source of error.
- Avoid glare on the borders, especially on foil cards.
- Use the full-resolution photo. On a 1000 px photo a border is only 20–30 px wide, so one pixel is worth about a point of centering.

## Limits

- Tuned and tested on a single photo so far (the sample, a Tag Team full art). Other frame styles may need the pink lines dragged into place.
- Expects the card upright (portrait) and filling a fair share of the photo. Strongly angled shots may need the corners dragged.
- Assumes a standard 63 × 88 mm card.
- The grade line shows commonly quoted PSA front-centering guidelines for centering only. Check the grader's current standards; it says nothing about corners, edges or surface.

## Layout

- `index.html`, `style.css` — the page
- `src/app.js` — UI: upload, drawing, dragging, results
- `src/detect.js` — card and border detection
- `src/geometry.js` — homography and perspective warp
- `samples/` — sample photo
