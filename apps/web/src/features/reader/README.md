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

## The selection toolbar (#203)

`components/reader/SourcePane` asks `model/toolbarPlacement.placeToolbar` where the toolbar goes, from the
selection's line quads and the page's type area (both from the IR, scaled to the scroller's content px) and
the visible column (`VirtualPageList`'s `FloatingGeometry.viewport`):

1. **In the page margin** beside the selection, level with its first line: the right margin, or the left
   one when the selection sits clearly in the left part of the text (a left column). Only when the space
   between the type area and the column's visible edge is at least the bar's width (126 px).
2. **Docked** across the top of the column (frame 07a), in a host outside the scroller so it stays put;
   across the bottom when a selected line is under the top band.

It never overlaps a selected line (a randomised test checks 2,000 layouts). Its items: **Explain** (runs now,
"Explain this passage."), **Ask** (`ReaderActions.askAbout`: the panel opens on the passage with the question
box focused; the reader's own words start the thread), **Highlight** in the last colour and the **five
washes**, **Send to board**, **Copy**, and **Explain with a diagram** only when its handler is given (the
diagram slice, #217; never an inert button). Below 640 px it is a bottom bar.

## Opening a highlight by mouse (#176): the hit-testing rule

The highlight layer is not a pointer target, so a drag that starts on highlighted words still selects them.
`SourcePane` listens for clicks on the pages and opens a highlight's card when `model/highlightClick`'s
`isHighlightClick` says the press was a click: a single, unshifted press that moved at most **5 px**
(`CLICK_SLOP_PX`; a hand's jitter of 4 px selected "o" and swallowed the click before), and the point lies
inside one of the highlight's stored quads (`hitsItem`, 1.5 pt slack). Whatever the jitter selected is
cleared. A press that moved further is a drag and selects; a double or triple click selects a word or a line;
Shift extends the selection. Enter on a focused highlight still opens it too.

## Contents (#177)

`model/contents`: the outline names each section by its heading with the number dropped (the explain panel's
rule, `evidence.section_display_title`), and the front matter as the paper's title plus any heading left
outside the section tree; never a parser type, and no "Belongs to no section" copy.

## Key files

- `components/ReaderHeader.tsx`: the bar. Below 640 px it takes two rows (`styles.css`, "H390").
- `model/pageCounter.ts`: "p. 2 of 15", pure.
- `model/toolbarPlacement.ts`, `model/highlightClick.ts`, `model/contents.ts`: the rules above, pure and
  tested beside them.
- `packages/ui/src/styles.css`, "the reader (S4)": the header, the desk (`--pt-desk` with a laid pattern),
  the PDF page as a `--pt-pdf-page` sheet with e1 (lamp-lit: the canvas is multiplied onto the dimmed sheet),
  and the Guided page on `--pt-page`.
