# reader

The reader's v0.2 chrome (#203, DESIGN.md §1 "Reader", frames 04 and 09b). The reading surfaces themselves
(Source, Guided, Split, highlights, the Contents panel) are still the v0.1 components in
`components/reader/`, restyled through the tokens; this folder holds what the revamp added around them.

## Data flow

UI (`components/ReaderHeader`) ← props from `app/paper/[id]/read/ReaderWorkspace.tsx` (composition only; its state lives in
`hooks/usePaperSource`, `useReadingPosition`, `useFocusAnchor`, `useHighlightActions`, and `features/split`'s
`useBoardBesideWiring`; the regions are `components/ReaderWorkspaceView`, `DocumentSlot`, `NavigatorSlot`), which owns every piece
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
drawn back from the same canvas, whose pixels the filter never touches, on a `--pt-pdf-mat` with up to 10 px of margin, never over other text: `figureMats` grows the box to hold the figure's own label blocks and stops each side's margin short of a caption or body text
(`PageMats`; none on a light page). **Guided** sets its sheet from `--pt-guided-*`, re-declaring the room's ink tokens
inside the sheet so everything in it follows the page, and puts figure and equation crops on the mat. Nothing eases a
colour (a fade races a scheme change; #200). What is painted ON the page uses page tokens: the flash ring, the
selection wash, the outline a flash leaves (`--pt-flash-rest`, 3:1 or better on each page) and the highlight washes.

## The selection menu and its paint (#203, #346)

**Paint.** A settled selection and every saved highlight are drawn as ONE band per line, never one box per
text item: `@papertree/anchoring`'s `mergeQuadsPerLine` (on `groupIntoLines` and `clampLineBands`) joins the quads
of a line across italic and inline-maths gaps, keeps two columns apart (a gap wider than the line's height is a
gutter), and keeps a taller maths run from reaching into the next line. Saved highlights still paint from their
STORED quads (ADR-002), merged only at paint time. The live selection is `PendingSelection`'s quads, drawn by
`HighlightOverlay` in `--pt-pdf-selection`, so it follows Light, Sepia and Dark. `SourcePane` marks the scroller
`data-pt-selpaint` while it does (a selection on at most two pages), and `styles.css` makes the text layer's native
`::selection` transparent under that mark; during a drag, and for a longer selection, the native wash is the
fallback. `components/reader/wordSnap` moves both ends of a settled selection to whole words on pointer-up, so
what is painted, quoted and anchored is the same passage.

**Place.** `hooks/useSelectionToolbar` (used by `components/reader/SourcePane`) asks
`model/toolbarPlacement.placeToolbar` where the menu goes. Its inputs are in the scroller's content px: every
selected line of the selection's first and last page (`selectionLines`; a selection across a page break brings
both, review B2), the page's type area from the IR, the visible column (`FloatingGeometry.viewport`), and the
menu's size **as drawn** (width too: it fits its longest label, "Send to board", and no label wraps).

1. **In the desk margin** beside the selection, level with its first line: the right margin, or the left one
   when the selection sits clearly in the left part of the text. Only when the space between the type area and
   the column's visible edge fits the drawn width.
2. **Docked**, when there is no margin (a narrow window, and the split view later): one compact row of icons and
   short labels ("Board" for Send to board), centred over the column in a host outside the scroller; icons only
   when the column is under 470 px; across the bottom when a selected line is under the top band. Below 640 px
   it is a bottom bar.

It never covers a selected line (2,000 random layouts in `toolbarPlacement.spec`; the drawn size in
`s4c-selection-toolbar.spec`; the screen in `e2e/v02/s4c-toolbar-placement.spec` and `e2e/v03/selection-menu.spec`).
A new press in the paper drops the previous menu at once (`useSelectionCapture`), and its labels cannot be
selected.

**Items**, in the prototype's order (`components/reader/SelectionItems`): **Explain** (the default question),
**Ask…** (`ReaderActions.askAbout`: the panel opens on the passage with the question box focused), **Send to
board** with two choices, **Board beside** (sends, then opens the board next to the paper on the new card: the
split view, `features/split`, key B; on a window under 768 px it opens the full-width board instead) and **Just send** (stays reading; the toast says "Added" with Show, which opens the board on
that card), **Note** (makes a highlight and opens its card on the note field: a highlight already carries a note;
no AI call, no board card) and the **five colours** (a colour keeps the highlight). No Copy (the selection is a
real selection) and no "Explain with a diagram" (diagrams live inside answers, #339). Every item is at least
40 px tall; the five colours are 24 px targets, 40 px on the phone.

**Keys** (`components/reader/useSelectionActions`). Enter on a fresh selection is Explain (left alone when focus
is on something that takes Enter itself); Esc clears the selection and its menu, one level. The menu is one tab
stop with roving focus (`useRovingFocus`): the arrows, Home and End move between its enabled buttons.

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

## Selecting a picture (v0.3 #348)

A figure, table, algorithm, display equation or any rectangle of a Source page is selected like words and
asked about through the same menu (`SelectionToolbar`, docked or in the margin; `useSelectionToolbar` is placed
by a `SelectionGeometry`, the selected lines of words or the picture's rectangle).

- **Floats** (`model/floats`): from the IR's blocks, outermost figure boxes only, each with its caption folded
  into the selectable box (the parser's `caption_block`, a `caption_of` relation, else the nearest caption within
  48 pt). `components/ImageLayer` draws a `button` per float in reading order (Tab walks them, Enter selects) and
  the faint hover outline; a mouse click is decided by `hooks/useImagePick` the way `useHighlightClick` decides
  (page element + `zoom x userUnit` into IR points), and a click on a painted highlight opens it instead.
- **Area tool**: the reader bar's "Select area" (`hooks/useImageTool`, a context the workspace mounts) or Alt+drag.
  The rectangle (`model/imageRegion`) has eight handles, moves by its body, and answers the arrow keys (Alt resizes,
  Shift takes bigger steps); armed from the keyboard it starts as a rectangle in the middle of the page.
- **Esc**, one level: a rectangle being drawn, then the armed tool, then the selection.
- **Shift** pairs a picture with words: the words stay, and the ask sends them as `with_text_anchor`.
- **Menu** (`hooks/useImageActions`): Explain and Ask open an `image` thread; Send to board makes an excerpt whose
  anchor is the picture and whose body is the caption; Note and a colour make a highlight over the region alone.
  The anchor (`lib/imageAnchor`) is exactly the API's: `figure` or `figure_region`, one PageSelector, one
  ShapeSelector quad, no quote.
- **Beside the board** the frame's chip is draggable: the board lands an image card where it is dropped.
- Colours are `--pt-pdf-img-*`, per page colour (Light, Sepia, Dark), contrast pinned in `packages/ui/test/tokens.spec.ts`.
