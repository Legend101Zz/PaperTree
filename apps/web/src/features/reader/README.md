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
- **Board** is a link to `/paper/<id>/board` (#214; the v0.1 `/paper/<id>/canvas` redirects there).
- **Zoom** is − / select / +; "Fit width" is one of the select's options, as frame 04 draws it.
- **Below 768 px (#205, frame 08b)** the header is one 56 px row: back, the title, "p. 2" (no count), Explain and a
  44 px menu button (`ReaderMenu`, a disclosure: Esc or a press outside closes it and focus goes back to the button)
  holding Contents, the reading mode, zoom and Board. `hooks/usePhone` reads the same 768 px query as
  `ExplainPanel`'s own, so the header and the sheet switch together. A zoom picked there survives a reload
  (measured at 390, `e2e/v02/phone-reader.spec.ts`). Every target on the row is 44 px (Explain is a `touch`
  `ToolbarButton`). While open, the menu is drawn above the explain sheet; focus leaving it closes it.
  Contents from the menu hands focus into the Contents panel and back to the menu button when it closes
  (`hooks/useMenuContentsFocus`). e2e specs reach these controls through `readingControls` (`e2e/s4/support.ts`),
  which opens the menu below 768 px.

## The page: Light, Sepia, Dark (#345; was the lamp-lit dimmed sheet, #205)

The paper has its own colour, separate from the room. `Aa` (`components/ReadingSettings`, the library's popover; in the
phone's menu just the two switches) holds **Page** (Auto · Light · Sepia · Dark) and **Room** (the theme switch). **Auto
is the default: the page follows the room** (Daylight gives a light page, Lamp-lit a dark one; owner decision F). The
override is `localStorage` `papertree.page`, like the theme, not the API. `features/settings` `usePage` (mounted in
`ReaderHeader`, which outlives the phone menu) writes `<html data-pt-page>`; `NO_FLASH_SCRIPT` sets it before paint.

The tokens are per page, not per room: `packages/ui` styles.css declares `--pt-pdf-*` (page, ink, mat, washes and
their underline inks, selection, ring, flash wash and rest) and `--pt-guided-*` in `:root[data-pt-page=...]` blocks,
and the dark room blocks declare none (`tokens.spec.ts` checks both, and recomputes every contrast).

**Source** recolours the canvas with CSS (`components/reader/pdfPage.css`), so a switch is live: no re-parse and no
re-render. Dark is `filter: invert(1) hue-rotate(180deg)` (lightness flips, hue stays) multiplied by the ink and
screened onto the page; Sepia is a multiply. pdf.js's `pageColors` was weighed and not used (it re-renders every
page, and recolours vector figures); the argument is in `PageMats.tsx`. Because the filter inverts figures too,
`figureRegions` (the IR's `figure` and `image` boxes, outermost only; a scanned page is one page-sized region) are
drawn back from the same canvas, whose pixels the filter never touches, on a `--pt-pdf-mat` with 10 px of margin
(`PageMats`; none on a light page). **Guided** sets its sheet from `--pt-guided-*`, re-declaring the room's ink tokens
inside the sheet so everything in it follows the page, and puts figure and equation crops on the mat. Nothing eases a
colour (a fade races a scheme change; #200). What is painted ON the page uses page tokens: the flash ring, the
selection wash, the outline a flash leaves (`--pt-flash-rest`, 3:1 or better on each page) and the highlight washes.

## The selection toolbar (#203)

`hooks/useSelectionToolbar` (used by `components/reader/SourcePane`) asks `model/toolbarPlacement.placeToolbar`
where the toolbar goes. Its inputs are in the scroller's content px: every selected line of the selection's
first and last page (`selectionLines`; a selection across a page break brings both, review B2), the page's
type area from the IR, the visible column (`VirtualPageList`'s `FloatingGeometry.viewport`), and the bar's
size **as drawn**: `SelectionToolbar` reports it before paint and on every resize, so a docked bar that wraps in
a narrow column is placed by its real height (review B1).

1. **In the page margin** beside the selection, level with its first line (the last page's, across a page
   break): the right margin, or the left one when the selection sits clearly in the left part of the text (a
   left column). Only when the space between the type area and the column's visible edge fits the 130 px bar.
2. **Docked** across the top of the column (frame 07a), in a host outside the scroller so it stays put;
   across the bottom when a selected line is under the top band.

It never covers a selected line: the pure function is checked on 2,000 random layouts, the hook with the bar's
drawn size (`s4c-selection-toolbar.spec`), and the screen in a browser (`e2e/v02/s4c-toolbar-placement.spec`).
A new mouse press in the paper drops the previous selection's bar at once (`useSelectionCapture`), and the
bar's labels cannot be selected, so a drag that ends in the margin never picks up the bar's words (e2e rfix
R1 A2 and R1b C).

Items: **Explain** (runs now, "Explain this passage."), **Ask** (`ReaderActions.askAbout`: the panel opens on
the passage with the question box focused; the reader's own words start the thread), **Highlight** in the last
colour and the **five washes** (24 px targets, 40 px on the phone's bar), **Send to board** (its toast says
"board"), **Copy**, and **Explain with a diagram** only when its handler is given (the diagram slice, #217;
never an inert button). Every item is at least 40 px tall. Below 640 px it is a bottom bar.

## Opening a highlight by mouse (#176): the hit-testing rule

The highlight layer is not a pointer target, so a drag that starts on highlighted words still selects them.
`hooks/useHighlightClick` listens for clicks on the pages and opens a highlight's card when
`model/highlightClick.isHighlightClick` says the press was a click: a single, unshifted press that moved at
most **5 px** (`CLICK_SLOP_PX`; a hand's jitter of 4 px selected "o" and swallowed the click before), and the
point lies inside one of the highlight's stored quads (`hitsItem`, 1.5 pt slack). Whatever the jitter selected
is cleared. A press that moved further is a drag and selects; a double or triple click selects a word or a
line; Shift extends the selection. Enter on a focused highlight still opens it too.

Two trade-offs (review N13): a one-letter word that starts on a highlight cannot be drag-selected (it needs more
than 5 px of travel; a double click selects it), and a double click on highlighted text shows the card for one
click interval before the second press closes it (as in v0.1). On touch a tap opens the card and a long press
selects.

## Contents (#177)

`model/contents`, rendered by `components/reader/Navigator`:

- Each section is named by its heading with the number dropped (the explain panel's rule,
  `evidence.section_display_title`).
- A section heading is not listed only when it is body text: its block is typed as running text, or it reads
  as the tail of a sentence (ends with a full stop, fewer than three words, starts in lowercase, like the real
  Attention parse's "scholarly works."). Its subsections take its place. "t-SNE background", "word2vec
  embeddings" and a run-in "Background." stay.
- Front matter is the paper's title, wherever the parse put it, plus any heading before the first section;
  never an author or the arXiv banner, and nothing when there is neither. When a section is headed by the
  title block (the real ResNet parse), the title is listed once, as that section.
- Blocks outside the section tree read in plain words ("Page number 7", "Footnote: …"); no parser type name and
  no "Belongs to no section" copy anywhere.

## Key files

- `components/ReaderHeader.tsx`: the bar; below 768 px the phone row and `components/ReaderMenu.tsx`.
- `model/pageCounter.ts`: "p. 2 of 15", pure.
- `model/toolbarPlacement.ts`, `model/highlightClick.ts`, `model/contents.ts`: the rules above, pure and
  tested beside them; `hooks/useSelectionToolbar.tsx` and `hooks/useHighlightClick.ts`: their wiring.
- `components/PageCounter.tsx`: "p. 2 of 15", subscribed to the page list on its own.
- `components/reader/guidedTables.ts` (v0.1 folder): a Guided table wider than its column is a named region
  ("Table: <caption or first header>") and a tab stop, so a keyboard can scroll it; one that fits is neither.
- `packages/ui/src/styles.css`, "the reader (S4)": the header, the desk (`--pt-desk` with a laid pattern),
  the PDF page as a `--pt-pdf-page` sheet with e1 (Light, Sepia or Dark: the canvas is recoloured by CSS, `pdfPage.css`),
  and the Guided page on `--pt-page`.
