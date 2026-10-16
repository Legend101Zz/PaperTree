# library

The signed-in library at `/dashboard` (#195, #196, #197; frames 00, 01, 01b, 01c, 01d, 01f): the papers stand as cloth
spines on one walnut plank, a row per group, each row under a brass label holder. A spine shows its state: a red ribbon
while you are reading it, a kraft wrap while we read it, a torn red label when we could not. The Table view lists the
same papers as a ruled catalogue.

- **Reading now** (above the spines; the owner's default, which may become a book stand): the papers you have a
  place in and have not finished, most recently opened first, at most three, each with its cloth, ribbon,
  "p. 4 of 15", the rule and **Continue**. "N reading now" in the stats line counts the same set
  (`isReadingNow`). Continue writes the server's page into the reader's own place
  (`papertree/reader/<paper_id>`, contracts.md §5) and opens the reader, so a place read on another device is
  honoured; a place already on that page keeps its exact line; a LATER place in this browser than on the server
  (its write was lost: `readingStateSync` never retries) is kept and sent to the server again
  (`planContinue`). The library checks a stored place exactly as the reader does (`readerPlace`, held to the
  reader's `readSavedReaderState` by `test/library-reader-place.spec.ts`).
- **Empty** (01b): "No papers yet" in the stats slot, the view tabs (no Arrange by), and an empty plank with the
  accession slip: "Drop PDFs here or choose files" (the header's picker; drops land in the page-wide target)
  and what happens next.
- **Few** (01c): at **12 papers or fewer** (`FACE_OUT_MAX`, owner may change) the books stand face-out as
  typographic covers in their cloth, as many to a plank as fit (four at 1440 px), each with its caption under
  the plank: title, authors · year · pages, the topic once topics exist, then Continue with the rule while you
  read it, or the state ("Read", "Not started", "Queued"…) and Open. The covers keep the spines' keyboard
  model (`useRovingShelf`); the caption's buttons are ordinary tab stops. A face-out library carries Continue
  itself, so Reading now is not shown above it (01c draws no strip); the strip is decided from the whole
  library, so the "need a look" filter never hides it.
- **Focus across layouts:** the shelf swaps components at its thresholds, so the roving tab stop lives in the
  section (`useShelfFocus`), keyed by paper id. When a commit removes the focused book (Delete, an upload
  crossing a threshold, a poll) and focus fell to the page, it goes back to the same paper's book, or Delete's
  neighbour; focus the person moved elsewhere is left alone.
- **Many** (01f): past **40 papers** (`AT_SCALE_MIN`, owner may change) each row (a topic, or the arrangement's
  group) stands on its own plank, with shorter spines, and scrolls sideways. A row wider than the page says
  "28 of 36 shown · scroll sideways" on its plank and ends in a sticky "+8 more" bookend: a tab stop that brings
  the next spine into view and focus (and with it the shelf's tab stop). While a search runs the bookend says
  how many of those it hides match ("3 matches here"); the header's "2 of 24" always counts every match. The
  bookend counts only what is past the right edge: once a row is scrolled, matches off to the left are counted
  in the header but not on the bookend. A spine the arrows focus scrolls clear of the bookend
  (`scroll-padding-inline-end` and a `nearest` scroll, WCAG 2.4.11). The
  stats line drops the pages at scale. Nothing is virtualised (ADR-004): every spine is drawn, and a search
  re-renders only the spines whose match changed (memoised rows and spines).

- **Header:** the sprout and name; the search ("/" focuses it, Esc clears it, "2 of 24" inside the field, Enter
  takes down the first match); Add papers; Aa (the theme switch from `features/settings`); the account (its
  initial; a menu with the email and Sign out).
- **Uploads** show as a quiet row under the header with Cancel; PDFs also drop anywhere on the page.
- **Title block:** "Your library", the stats line computed from the papers ("24 papers · 6 topics · 3 reading
  now · 484 pages", leaving out what is zero; nothing at all until the list has loaded), and "N need a look"
  (queued, being read or failed), which **opens the Table filtered to those papers** (#197, the owner's default,
  owner may change; before #197 it filtered the shelf) and switches itself off when nothing needs a look.
- **Views:** Shelf and Table are live; Topics and Map are shown disabled with "Coming in this release" (S2g).
  Arrange by (Topic, Year, Title, Recently opened) stands at the right of the view row for the shelf, Columns for
  the Table. The shelf stays mounted, hidden, under the Table, so its roving focus, open card and sideways scroll
  survive a switch of view; the search is the page's and filters both.
- **The Table** (01d) is a native `<table>`: Title (a link to the reader), Authors (first author "et al.";
  three or more open "Authors · full", a popover with every name), Year, Topic (its cloth, name and source line,
  "arXiv cs.CL · accepted", "chosen by you" or "suggested · accepted"; else "Unshelved"), Pages, State
  ("Reading now · p. 4 of 15", "Read", "Not started", "Queued" / "Reading · Readable in Source mode now", "Could
  not read" with Retry · Remove), Highlights, Last opened (`reading.opened_at`, "16 Oct"). A missing value is a
  dash that a screen reader hears as "unknown", "none" or "never"; nothing is invented. Every header sorts
  (`aria-sort`; a second press reverses; a missing value sorts last both ways; ties go by title, so "Sorted by
  topic, then title" is literal). Chips over it: All, Reading now, Read, Not started and "N need a look", counted
  over the whole library (the states partition it); with "need a look" on, only All and that chip show, with a
  sentence saying why ("LoRA is still being read; SuperGLUE could not be read."). Filter: topic, a year range
  and a pages range (a paper with no year or no page count is in no range). Columns hides any column but Title,
  stored per viewer (`papertree/library/table-columns`, try/catch). A row's arrow opens the reader (for a
  pointer; the title link is the keyboard's one stop); its "…" menu has Open, Retry (could not read only),
  Remove (confirmed in a row under it, with the card's confirmation) and Show on the shelf (the Shelf tab, that
  spine focused). After Retry focus is on the row's title, after Remove on the next row's. At phone width the
  table scrolls sideways in its own region with the titles held at the left; every column stays reachable.
  Nothing is virtualised: 400 rows are measured in `research/build/v0.2-ui/shots/S2f/README.md`.
- **The shelf** is one tab stop: ←/→ walk along it, Home and End jump to its ends. Enter or a click takes a
  book down: its catalogue card opens in the band above, pointing at the spine, with focus on Read (Enter again
  opens the reader), Retry for a paper we could not read, and Delete (danger, confirmed inline). Esc puts it
  back and returns focus to the spine. The card is keyed by paper (an armed Delete never follows it to
  the next book), sits in the band's flow (a taller card moves the shelf down rather than covering the view
  row) and re-points at its spine whenever the shelf re-lays itself out. Focus never falls to the page: after
  Retry it is on Read, after Delete on the next spine (else the previous, else Add papers), after "Got it" on
  the shelf. A search dims what does not match and lights what does, without reordering anything; the hint
  row under the plank says what the keys do.
- **Touch:** on a phone width or a coarse pointer every control in the header, title row and hints is 44 px
  (`useTouchTargets`); on a desktop they keep frame 01's 36–40 px. The spines keep their 26–48 px widths
  (WCAG 2.5.8's 24 px holds; the phone shelf is S2h).

## Data flow

`LibraryView` → `useLibrary` (TanStack Query, key `['papers']`) and `useUploadQueue` → `papersApi`
(`lib/api/papers.ts`) → `GET /papers`, `POST /papers`, `POST /papers/{id}/retry`, `DELETE /papers/{id}`
(services/api) → SQLite. Search, arrangement, the view, the Table's chip, filter and sort, and the open card are page
state (`useTableView` holds the Table's, so "need a look" can open it); nothing is stored but the "Got it" on the
key hints and the Table's hidden columns (localStorage, per browser).
The list is polled every 2 s only while a paper is queued or being read. Each row becomes a `LibraryBook`
(the v0.1 view model plus S2a's `year`, `reading` and `arxivCategory`); `model/shelf.ts` turns books into
rows and spines. Nothing is invented: no topic puts a paper under "Unshelved", no reading state means no
ribbon, no year means no year on the spine.

## Choices the owner may change

- **Cloth without a topic** (`clothFor`): cs.CL → transformers, cs.CV → vision, cs.LG and stat.ML →
  generative, math.OC and cs.NE → optimization, cs.IR → language, cs.AI / cs.RO / cs.MA → reinforcement;
  another category takes a stable cloth by hash, no category the slate cloth.
- **Spine width**: `26 + 0.85 × pages` px (fitted to frame 01), capped at 48; 40 while the page count is
  unknown or the paper is still being read, so the count arriving mid-parse does not reflow the shelf.
- **Order within a row**: shelving order (when added) for Topic; Year rows by title; Title A–Z; Recently
  opened most recent first.

## Key files

- `model/shelf.ts`: arrangements, spine width, height, title, author line, state, name, cloth, search
  matching, the arrow-key step (pure; tested in `model/shelf.spec.ts`).
- `model/shelf.ts` also: the stats line, "need a look", where the catalogue card goes (`placeCard`).
- `model/states.ts`: who is reading now, the face-out and at-scale thresholds, covers per plank, what a
  sideways row shows (`rowWindow`), the stats line (`statsLine`), Continue's reader place (pure; tested in
  `model/states.spec.ts`). `hooks/useContinue.ts` stores that place and opens the reader;
  `hooks/useRovingShelf.ts` is the one-tab-stop keyboard model for spines and covers;
  `hooks/useElementWidth.ts` measures the plank for `coversPerRow`.
- `model/table.ts`: the Table's State cell, chips and counts, the Filter model, the source line, the date and the
  "need a look" sentence; `model/tableSort.ts`: columns, the comparators (nulls last, ties by title), the caption,
  `tableRows` and the stored columns (pure; tested beside them). `hooks/useTableView.ts` holds the Table's state;
  `hooks/usePopover.ts` is every disclosure's open/close rules (the header menus too); `hooks/useBookActions.ts` is
  Retry and the confirmed Remove for the card and a row.
- `components/TableView.tsx` (chips, Filter, the table) with `TableRow.tsx`, `TableCells.tsx` (authors popover,
  topic, "…" menu), `TableMenus.tsx` (Columns, Filter), `RemoveConfirm.tsx` (shared with the card) and `table.css`.
- `hooks/useLibrary.ts`: the data layer (query, polling, upload, cancel's re-read, retry, delete);
  `hooks/useUploadQueue.ts`: the upload queue (progress, Cancel, refusals); `hooks/useCardPlacement.ts`.
- `components/LibraryView.tsx`: the page; `LibraryHeader.tsx` (with `SearchField.tsx`, `AddPapers.tsx`),
  `UploadRow.tsx`, `LibraryTitle.tsx`, `ShelfSection.tsx` (with `Shelf.tsx`, `Spine.tsx`, `ShelfPlank.tsx`,
  `CatalogueCard.tsx`, `ShelfHints.tsx`), `ReadingNow.tsx`, `AccessionSlip.tsx`, `CoverShelf.tsx` (with
  `Cover.tsx`, `CoverCaption.tsx`), `ShelfRows.tsx` (with `ShelfRow.tsx`); `library.css`: their styles, from the tokens.
- Tests: `apps/web/test/library-table.spec.tsx` (the Table through the page), `apps/web/test/library-shelf.spec.tsx`, `library-page.spec.tsx`, `library-states.spec.tsx` (with
  the corpus rows in `library-corpus.ts`), `s3-library-states.spec.tsx`, `w2ui-library.spec.tsx`; e2e
  `e2e/s2d/shelf.spec.ts`, `e2e/v02/library-states.spec.ts`, `e2e/v02/library-table.spec.ts` and `e2e/s3/*`.
