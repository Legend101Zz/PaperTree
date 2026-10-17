# library

The signed-in library at `/dashboard` (#195–#198; frames 00, 01, 01b–01f, 03): the papers stand as cloth
spines on one walnut plank, a row per group, each row under a brass label holder. A spine shows its state: a red ribbon
while you are reading it, a kraft wrap while we read it, a torn red label when we could not. The Table view lists the
same papers as a ruled catalogue, Topics shows each topic as a card, and the Map is a plan of the reading room.

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
  now · 484 pages", leaving out what is zero; nothing at all until the list has loaded; "N topics" is every topic in
  `GET /topics`, an empty one too, once it is read), and "N need a look"
  (queued, being read or failed), which **opens the Table filtered to those papers** (#197, the owner's default,
  owner may change; before #197 it filtered the shelf) and switches itself off when nothing needs a look.
- **Views:** Shelf, Topics, Map and Table, all live. Arrange by (Topic, Year, Title, Recently opened) stands at the right of the view row for the shelf, Columns
  for the Table, New topic for Topics. The shelf stays mounted, hidden, under the other views, so its roving focus,
  open card and sideways scroll survive a switch of view; the search is the page's and filters every view. Enter
  in the search acts on the view showing (the Table's first row, the first lit topic card, else a lit Unshelved
  row, the shelf's first match taken down) and never changes a hidden view (`hooks/useViewNavigation.ts`).
- **Topics** (03, #198): one card per topic in the server's shelf order (`GET /topics`): a 120 px banner in the
  topic's cloth with that cloth's pattern, a gilt frame and the ornament (a plate figure needs S3's plate, so no
  card shows one and none is ever blank), the name, "2 papers · 31 pages · 1 reading now" (the third part is the
  most pressing state: reading now, could not read, being read, read, else "not started"), a skyline of its spines
  (the shelf's widths, heights, cloth, ribbon, kraft and torn label at about a fifth of the size; the first 12, then
  "+n") and the source line said once ("Suggested from arXiv cs.CL · you accepted", "· 1 chosen by you" for papers
  the person put there, "Chosen by you" for a topic of only those, "Made by you" when empty). The cards are one tab
  stop (←/→ along, ↑/↓ a row, Home, End; Tab then reaches that card's "…"); Enter or a click on a card shows the
  topic on the shelf: Arrange by Topic, with its first book focused (the owner's choice; DESIGN.md names no topic
  page). An empty topic's name is `aria-disabled` and opens nothing. "…" renames and recolours (the six cloths, by
  colour name) in one form, and deletes after an inline confirmation that says the papers go back to Unshelved and
  stay; focus then goes to the neighbouring card, or New topic. **Unshelved** lists the papers with no accepted topic
  (shelving order, eight then "Show all", which puts focus on the first paper it brings in), each with its offer from `GET /papers/{id}/topic` ("Suggested: Vision &
  detection · from arXiv cs.CL", or "No suggestion yet") and Accept, Not this, or a topic of the person's choosing
  (a select and Shelve). An offer never shelves anything; S2b offers only a topic that already holds a paper of the
  same arXiv category, so a new person's first paper on a topic is always their own choice. A name already used is
  refused beside the field in our words ("You already have a topic called “…” (letter case aside)"), the typed name
  kept. A topic made without a cloth opens its form with none chosen, so a rename never colours it. The open card's
  "…" panel stands above every other card. Sample papers (fixtures on) are not the person's and take no topic; a line
  under Unshelved says so.
- **Map** (01e, #198): "Plan of the reading room", one SVG laid out by `model/map.ts`. Each topic (in the topics'
  order, an empty one too, and a paper's accepted topic even if `GET /topics` lacks it) is a hatched island in a
  fixed cell of a grid (three to a row at 1440, one on a phone), sized by its papers' estimated label widths;
  Unshelved is a dashed island after them. Its cartouche is at most its cell's width and stays on the plan: a long
  name or line is cut with "…" (whole in the cartouche's `<title>` and in the list). Its papers stand inside as small
  cloth spines with their short titles (cut to the room, "· being read" on kraft, "· could not read" in red, a ribbon
  while reading); past the room, "+n more". A cell depends only on its index and its own papers, so papers arriving
  in or leaving one topic never move or resize another. **Only real links:** the citation links `GET /library/links`
  returned, dotted (the "references" thread) with an arrowhead at the cited paper and a paper tag "cites it /
  matched by title" (worded from `matched_by`; the link's `<title>` says it too). A tag goes on or beside its curve,
  searched from the middle outwards, to the first place that covers no paper, cartouche or other tag; a link with no
  such place has no tag on the plan and is labelled in the list only, and the legend counts those ("15 (3 labelled
  only in the list)", measured on the 14-paper corpus at 1440). Nothing is drawn for papers that are merely alike.
  The legend counts the links ("· 3", "none yet", "loading", "could not be read") and says "Papers you linked on a
  board · none yet": a board holds one paper (S2c). The plan is `role="img"` with a name that never claims a count it
  does not have ("2 topics, 5 papers, 3 citation links", "citation links still loading", "the citation links could
  not be read"). A failed links read, or a failed topics read (then a topic with no papers is missing, and the plan
  says so instead of "No topics yet"), is an alert with Try again. **The plan as a list** after it (a disclosure, one
  Tab stop; hidden while the topics load) lists the topics, their papers (links to the reader, with "· being read",
  "· could not read", "· reading now") and every link in words ("BERT cites Attention Is All You Need · matched by
  title"). A search dims the papers it does not match and rings the ones it does; Enter in it opens the list at the
  first matching paper. Sample papers (fixtures on) are on neither Topics nor the Map, and the note says so.
- **The Table** (01d) is a native `<table>`: Title (a link to the reader), Authors (first author "et al.";
  three or more open "Authors · full", a popover with every name), Year, Topic (its cloth, name and source line,
  "arXiv cs.CL · accepted", "chosen by you" or "suggested · accepted"; else "Unshelved"), Pages, State
  ("Reading now · p. 4 of 15" (the stats line's set), "Read", "Not started" ("Some parts unreadable" under it
  for our partial reading; "Opened" for a place in a paper whose page count is unknown), "Queued" / "Reading ·
  Readable in Source mode now", "Could not read" with Retry · Remove, which says it is busy while it runs and
  sends one request however often it is pressed), Highlights, Last opened (`reading.opened_at`, "16 Oct"). A missing value is a
  dash that a screen reader hears as "unknown", "none" or "never"; nothing is invented. Every header sorts
  (`aria-sort`; a second press reverses; a missing value sorts last both ways; ties go by title, so "Sorted by
  topic, then title" is literal; Authors sort by the first author's surname). Chips over it: All, Reading now,
  Read, Not started and "N need a look", counted over what the search and the Filter leave, so a chip's number
  is the rows it shows (the states partition any set; the title's "N need a look" counts the whole library);
  with "need a look" on, only All and that chip show, with a sentence saying why ("LoRA is still being read;
  SuperGLUE could not be read."). An empty table says what emptied it (the chip, the search or the Filter).
  Filter: topic, a year range and a pages range (a paper with no year or no page count is in no range); a topic
  that leaves the library leaves the Filter too. Columns hides any column but Title, stored in this browser
  (`papertree/library/table-columns`, try/catch). A row's arrow opens the reader (for a pointer; the title link
  is the keyboard's one stop); its "…" menu has Open, Retry (could not read only),
  Remove (confirmed in a row under it, with the card's confirmation) and Show on the shelf (the Shelf tab, that
  spine focused). After Retry focus is on the row's title, after Remove on the next row's. Every popover and
  menu closes when focus leaves it. At phone width the table scrolls sideways in its own region with the titles
  (about 58% of the screen, up to three lines) held at the left; every column stays reachable, and a row's
  popover or menu is placed on the screen (upward on the last rows), so the region never clips it. A poll
  re-draws only the rows whose paper changed: `useLibrary` keeps an unchanged paper's object.
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
key hints and the Table's hidden columns (localStorage, per browser). Topics: `TopicsView` → `useTopics`
(keys `['topics']` and `['paper-topic', id, state]`) → `topicsApi` (`lib/api/topics.ts`) → `GET/POST /topics`,
`PATCH/DELETE /topics/{id}`, `GET/PUT /papers/{id}/topic`, `POST /papers/{id}/topic/reject` (`routers/topics.py`)
→ SQLite (`topics`, `paper_topics`, migration 0009); a paper's accepted topic comes back on its `GET /papers` row.
Map: `MapView` → `useTopics` and TanStack Query `['library-links']` → `papersApi.links` → `GET /library/links`
(computed on read from the parses, nothing stored) → `model/map.ts` lays the plan out.
The list is polled every 2 s only while a paper is queued or being read. Each row becomes a `LibraryBook`
(the v0.1 view model plus S2a's `year`, `reading` and `arxivCategory`); `model/shelf.ts` turns books into
rows and spines. Nothing is invented: no topic puts a paper under "Unshelved", no reading state means no
ribbon, no year means no year on the spine.

## Choices the owner may change

- **The Map's rows are all one height** (about 445 px at 1440): that is what keeps every island in place when
  another grows, at the price of empty space under a row of small or empty topics (12 topics with 5 empty make a
  plan about 1,570 px tall).

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
- `model/topics.ts`: the cards' papers, stats, source line, an offer in words, a new topic's cloth and the grid's
  arrow step (pure; tested in `model/topics.spec.ts`). `hooks/useTopics.ts` is `GET /topics`, every topic write
  (each re-reads topics, papers and offers) and the Unshelved offers (`lib/api/topics.ts`).
- `components/TopicsView.tsx` with `TopicCard.tsx`, `TopicActions.tsx` (the "…" menu), `TopicForm.tsx` (name and
  cloth, shared with `NewTopic.tsx`), `UnshelvedCard.tsx` and `topics.css`; `hooks/useViewNavigation.ts` is "Show on
  the shelf", Enter on a topic card and Enter in the search; tests in `apps/web/test/library-topics.spec.tsx`.
- `model/map.ts`: the Map's groups, the plan (`layoutMap`), the drawn links and their words (pure; tested in
  `model/map.spec.ts`); `components/MapView.tsx` (legend, data) with `MapPlan.tsx` (the SVG), `MapList.tsx` (the
  list alternative) and `map.css`; tests in `apps/web/test/library-map.spec.tsx`; e2e
  `e2e/v02/library-topics-map.spec.ts`.
- `model/table.ts`: the Table's State cell, chips and counts, the Filter model, the source line, the date and the
  "need a look" sentence; `model/tableSort.ts`: columns, the comparators (nulls last, ties by title), the caption,
  `tablePool` and `tableRows`, and the stored columns (pure; tested beside them). `hooks/useTableView.ts` holds
  the Table's state; `hooks/usePopover.ts` is every disclosure's open/close rules (Esc, a press outside, focus
  leaving; the header menus too), drawn by `PopoverMenu.tsx`; `hooks/usePanelPlace.ts` places a row's popover
  and menu on the screen; `hooks/useBookActions.ts` is Retry and the confirmed Remove for the card and a row,
  with one guard against a second request.
- `components/TableView.tsx` (Filter, the table) with `TableChips.tsx`, `TableRow.tsx`, `TableCells.tsx` (authors
  popover, topic, "…" menu), `TableMenus.tsx` (Columns, Filter), `RemoveConfirm.tsx` (shared with the card) and
  `table.css`.
- `hooks/useLibrary.ts`: the data layer (query, polling, upload, cancel's re-read, retry, delete);
  `hooks/useUploadQueue.ts`: the upload queue (progress, Cancel, refusals); `hooks/useCardPlacement.ts`.
- `components/LibraryView.tsx`: the page; `LibraryHeader.tsx` (with `SearchField.tsx`, `AddPapers.tsx`),
  `UploadRow.tsx`, `LibraryTitle.tsx`, `ShelfSection.tsx` (with `Shelf.tsx`, `Spine.tsx`, `ShelfPlank.tsx`,
  `CatalogueCard.tsx`, `ShelfHints.tsx`), `ReadingNow.tsx`, `AccessionSlip.tsx`, `CoverShelf.tsx` (with
  `Cover.tsx`, `CoverCaption.tsx`), `ShelfRows.tsx` (with `ShelfRow.tsx`); `library.css`: their styles, from the tokens.
- Tests: `apps/web/test/library-table.spec.tsx` (the Table through the page), `apps/web/test/library-shelf.spec.tsx`, `library-page.spec.tsx`, `library-states.spec.tsx` (with
  the corpus rows in `library-corpus.ts`), `s3-library-states.spec.tsx`, `w2ui-library.spec.tsx`; e2e
  `e2e/s2d/shelf.spec.ts`, `e2e/v02/library-states.spec.ts`, `e2e/v02/library-table.spec.ts` and `e2e/s3/*`.
