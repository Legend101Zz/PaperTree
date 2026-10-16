# reader

The reader's v0.2 chrome (#203, DESIGN.md §1 "Reader", frames 04 and 09b). The reading surfaces themselves
(Source, Guided, Split, highlights, the Contents panel) are still the v0.1 components in
`components/reader/`, restyled through the tokens; this folder holds what the revamp added around them.

## Data flow

UI (`components/ReaderHeader`) ← props from `app/paper/[id]/read/ReaderWorkspace.tsx`, which owns every piece
of state the header shows: the reading mode and zoom (saved per paper in `localStorage`, contracts.md §5), the
page at the top of the view (reported by Source's scroller and Guided's top block), the Contents panel, and
the Explain toggle (`useExplainActions`, `components/explain`). Presses go back up as callbacks; the header
calls no API. The page count comes from pdf.js (`usePdfDocument`) or, before the PDF opens, the parse.

- **Explain** is a `ToolbarButton` toggle (`aria-pressed`). The workspace hands its ref to `ExplainPanel`
  (`toggleRef`), so the panel draws no floating "Ask AI" launcher and gives focus back to the toggle when it
  closes. From 768 px the drawer opens under the 56 px header, which stays the full window width.
- **Board** is a link to `/paper/<id>/canvas` (the route keeps its v0.1 name; the wording is the design's).
- **Zoom** is − / select / +; "Fit width" is one of the select's options, as frame 04 draws it.

## Key files

- `components/ReaderHeader.tsx`: the bar. Below 640 px it takes two rows (`styles.css`, "H390").
- `model/pageCounter.ts`: "p. 2 of 15", pure.
- `packages/ui/src/styles.css`, "the reader (S4)": the header, the desk (`--pt-desk` with a laid pattern),
  the PDF page as a `--pt-pdf-page` sheet with e1 (lamp-lit: the canvas is multiplied onto the dimmed sheet),
  and the Guided page on `--pt-page`.
