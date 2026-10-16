# notebook

The notebook's pure model (slice S5b, issue #207). The UI comes in S5c (page, items) and S5d (ink
toolbar, lasso and eraser interaction); this folder has no React, DOM or network code.

## Data flow (as it will be wired)

pointer input -> `screenToPage` -> a `Stroke` in page units -> `execute(add-strokes)` in the
notebook store -> `encodeStroke` -> API -> one SQLite blob per stroke. Reading runs the other way:
`decodeStroke` -> `strokeToPath` (cache the `d` string) -> one `<svg viewBox="0 0 960 H">`.

## Key files (`model/`)

- `page.ts`: fixed page width (960 units), page/screen conversion, the `Item` union, the five templates.
- `stroke.ts`: `Stroke` and the compact binary format (zigzag varint deltas at 1/16 unit, 1 pressure byte).
- `outline.ts`: stroke to filled SVG path through `perfect-freehand` 1.2.3 with explicit options.
- `hitTest.ts`: polygon lasso (strokes: half their points inside; items: centre inside) and the whole-stroke eraser.
- `history.ts`: undo/redo of commands (add, remove, move, edit text) with a cap.

Colours are token names (`pen`, `hl-amber`), never hex, so the lamp-lit scheme can re-map them.
