# library

The signed-in library at `/dashboard` (#195, #196; frames 00, 01, 01b): the papers stand as cloth spines on
one walnut plank, a row per group, each row under a brass label holder. A spine shows its state: a red ribbon
while you are reading it, a kraft wrap while we read it, a torn red label when we could not.

- **Reading now** (above the spines; the owner's default, which may become a book stand): the papers you have a
  place in and have not finished, most recently opened first, at most three, each with its cloth, ribbon,
  "p. 4 of 15", the rule and **Continue**. "N reading now" in the stats line counts the same set
  (`isReadingNow`). Continue writes the server's page into the reader's own place
  (`papertree/reader/<paper_id>`, contracts.md §5) and opens the reader, so a place read on another device is
  honoured; a place already on that page keeps its exact line.
- **Empty** (01b): "No papers yet" in the stats slot, the view tabs (no Arrange by), and an empty plank with the
  accession slip: "Drop PDFs here or choose files" (the header's picker; drops land in the page-wide target)
  and what happens next.

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
- `model/states.ts`: who is reading now and Continue's reader place (pure; tested in
  `model/states.spec.ts`). `hooks/useContinue.ts` stores that place and opens the reader.
- `hooks/useLibrary.ts`: the data layer (query, polling, upload, cancel's re-read, retry, delete);
  `hooks/useUploadQueue.ts`: the upload queue (progress, Cancel, refusals); `hooks/useCardPlacement.ts`.
- `components/LibraryView.tsx`: the page; `LibraryHeader.tsx` (with `SearchField.tsx`, `AddPapers.tsx`),
  `UploadRow.tsx`, `LibraryTitle.tsx`, `ShelfSection.tsx` (with `Shelf.tsx`, `Spine.tsx`, `ShelfPlank.tsx`,
  `CatalogueCard.tsx`, `ShelfHints.tsx`), `ReadingNow.tsx`, `AccessionSlip.tsx`; `library.css`: their styles, from the tokens.
- Tests: `apps/web/test/library-shelf.spec.tsx`, `library-page.spec.tsx`, `library-states.spec.tsx` (with
  the corpus rows in `library-corpus.ts`), `s3-library-states.spec.tsx`, `w2ui-library.spec.tsx`; e2e
  `e2e/s2d/shelf.spec.ts` and `e2e/s3/*`.
