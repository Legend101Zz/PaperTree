# library

The signed-in library at `/dashboard` (#195, #196; frames 00, 01, 01b, 01c, 01f): the papers stand as cloth spines on
one walnut plank, a row per group, each row under a brass label holder. A spine shows its state: a red ribbon
while you are reading it, a kraft wrap while we read it, a torn red label when we could not.

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
  (queued, being read or failed), which for now filters the shelf to those papers and switches itself off
  when nothing needs a look (owner may change; S2f makes it open the Table filtered).
- **Views:** Shelf is live; Topics, Map and Table are shown disabled with "Coming in this release" (S2f, S2g).
  Arrange by: Topic, Year, Title, Recently opened.
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
(services/api) → SQLite. Search, arrangement, the filter and the open card are page state; nothing is stored
but the "Got it" on the key hints (localStorage, per browser).
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
- `hooks/useLibrary.ts`: the data layer (query, polling, upload, cancel's re-read, retry, delete);
  `hooks/useUploadQueue.ts`: the upload queue (progress, Cancel, refusals); `hooks/useCardPlacement.ts`.
- `components/LibraryView.tsx`: the page; `LibraryHeader.tsx` (with `SearchField.tsx`, `AddPapers.tsx`),
  `UploadRow.tsx`, `LibraryTitle.tsx`, `ShelfSection.tsx` (with `Shelf.tsx`, `Spine.tsx`, `ShelfPlank.tsx`,
  `CatalogueCard.tsx`, `ShelfHints.tsx`), `ReadingNow.tsx`, `AccessionSlip.tsx`, `CoverShelf.tsx` (with
  `Cover.tsx`, `CoverCaption.tsx`), `ShelfRows.tsx` (with `ShelfRow.tsx`); `library.css`: their styles, from the tokens.
- Tests: `apps/web/test/library-shelf.spec.tsx`, `library-page.spec.tsx`, `library-states.spec.tsx` (with
  the corpus rows in `library-corpus.ts`), `s3-library-states.spec.tsx`, `w2ui-library.spec.tsx`; e2e
  `e2e/s2d/shelf.spec.ts`, `e2e/v02/library-states.spec.ts` and `e2e/s3/*`.
