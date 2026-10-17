# GAP-A1: library, the opened book, topics, map, table, reading progress (+ phone, lamp-lit)

Audited 2026-10-16 against commit 79f637d (worktree `v02-ui`, `main` = v0.1.0 + docs). Compared the 12 frames in `PaperTree-design/v0.2/compare/F-final/` with the running dev stack (web 18901, API 18902, FAUX agent), the code under `apps/web`, `packages/ui`, `services/api/python/papertree_api`, `services/document-worker`, `infrastructure/migrations/0001..0005`, and the demo SQLite (`PaperTree-scratch/v02-data/papertree.sqlite`, read-only).

Headline: **the v0.2 library does not exist yet.** `/dashboard` is the v0.1 "My papers" card grid / list (`apps/web/src/components/library/LibraryView.tsx`, 335 lines). None of the shelf, topics, map, table, opened book, header, search, Arrange-by, Reading now, theme switch or phone layout is built. There is no v0.2 library code behind a flag either (`git grep` for walnut/gilt/brass/ex libris/bookplate in `apps/web/src` and `packages/ui/src` finds nothing, and the web uses the system font stack, `app/layout.tsx:18`, not the design's Libre Caslon / Alegreya fonts). Because of that, almost every row below is **missing**; the interesting part is the backend column, which says what is already served and what is not.

Status key: exists / partial / missing / wrong (wrong = present but contradicts the design or a product truth).

## Method notes and what could not be verified

- The shared dev web server dropped the dashboard route's chunk for several minutes mid-audit (`/_next/static/chunks/app/dashboard/page.js` 404; three agents share one `next dev`; I did not touch it). Blank shots from that window were deleted and retaken after it recovered. Current-app screenshots, all of the v0.1 card grid: `shots/01-shelf-current.png` (light 1440x900), `shots/01-shelf-current-dark.png` (dark 1440x900, follows the OS preference, confirmed working), `shots/08a-phone-library-current.png` (390 wide, full height: one column of cards, header is just wordmark + Sign out). `shots/01-shelf-1440-current.png` is a sibling agent's or earlier identical capture.
- There is no opened-book screenshot because there is no opened book; opening a card navigates to `/paper/<id>/read` (`LibraryView.tsx` `openPaper`).
- Data checks were done with `sqlite3 -readonly` on the demo database and `curl` with the demo bearer token.

## What the backend actually serves for the library today

`GET /papers` returns, per paper (schema `LibraryPaper`, `schemas.py:402`): `paper_id, title, authors[], original_filename, source_hash, page_count, processing (queued|reading|ready|partial|failed), job{...}, generation, parser_version, highlight_count, created_at, updated_at`. Verified with the demo token: 4 papers (Attention 15 pp, DDPM 25 pp, ResNet 12 pp, YOLO 10 pp), Attention `highlight_count: 1`.

Not in that payload: year, arXiv id, arXiv category, venue, abstract, thread count, notebook count, last-opened time, reading position, topic, figure presence, summary state. `GET /auth/me` returns only `{user_id, email}` (`routers/auth.py:94`); the `users` table has `user_id, email, created_at` and nothing else.

Routes that exist (OpenAPI paths): auth x4, `/papers` (list, upload), `/papers/{id}` (get, delete), `/file`, `/ir`, `/pages`, `/blocks`, `/relations`, `/blocks/{id}/location`, `/assets/{kind}/{block_id}`, `/highlights` (+resolutions, +id), `/threads` (+id, +messages), `/summary` (GET status, POST), `/board` (+nodes, edges), `/retry`, `/reparse`, `/jobs/{id}`, `/usage`, `/healthz`. No topics, reading-state, preferences, profile, or links endpoint.

---

## Frame 00-strip (library furniture only)

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 00-strip | Cloth covers, gilt lines, brass bookends, walnut shelf, label holders (CSS furniture) | missing | No such CSS or components anywhere in `apps/web/src` or `packages/ui/src`; `shots/01-shelf-1440-current.png` shows a flat white card grid | none (pure front end) | #195, #188 |
| 00-strip | Display faces (Libre Caslon, Alegreya Sans, Courier Prime) | missing | `app/layout.tsx:18-21` uses the system font stack; `apps/web/package.json` has no `@fontsource/*` | none | #195, #188 |
| 00-strip | Spine states: ribbon = reading now, kraft wrap = still being read, torn red label = could not read | missing | The only state vocabulary is the v0.1 pill (`PROCESSING_LABEL`, `library/types.ts:47`: Queued / Reading / Partly read / Ready / Could not read). The state machine behind it is sound and maps one to one (`types.ts` `STATE_FROM_WIRE`), except "reading now" (see Reading progress) | "ribbon" needs reading position, see below | #195, #188 |
| 00-strip | Spine width from page count (cap 48 px) | partial | `page_count` is served (`/papers`: 15, 25, 12, 10) and is 0/null while unparsed (`types.ts:28`). Width is a pure front-end function (ADR-004 2.3) | none; `page_count` is null for a paper whose parse never started, so spine needs a default width | #195, #188 |
| 00-strip | Spine text: title, "AUTHOR ET AL.", year | partial | title, authors served. **Year is not served**, and what the parser stores is wrong for spines, see Risks (Attention 2023, BERT 2019, YOLO 2016 vs the design's 2017, 2018, 2015) | add `year` (and fix its source) to `LibraryPaper`, see designs below | #195, #188 |

## Frame 01-shelf-1440 (default state and typing "atten")

Screenshots of the current app for this frame: `shots/01-shelf-current.png` (light), `shots/01-shelf-current-dark.png` (dark, via OS preference).

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 01 | Page title "Your library" | wrong | Current heading is "My papers" (`LibraryView.tsx` `<h1>`); screenshot | none | #195, #196 |
| 01 | Header: sprout mark, "PaperTree" | partial | Wordmark only, no sprout (`LibraryView.tsx` `pt-s3-brand`); screenshot | none | #195, #196 |
| 01 | Header: central search with "/" hint | missing | No search input anywhere in `components/library`; no key handler (`onKeyDown`/`keydown` grep finds none in library or dashboard) | none: search is client-side over the loaded list. Title and authors are in `/papers`; "topics" needs the topic data below | #195, #196 |
| 01 | Header: "Add papers" button | partial | Upload is a large dashed dropzone in the page body, not a header button (`UploadDropzone.tsx`, `data-upload-dropzone`); `focusUpload` exists and clicks the hidden file input | none | #195, #196 |
| 01 | Header: Aa (reading settings) | missing | No Aa control in the library (the reader has its own state only). There is **no theme switch anywhere**: nothing sets `data-pt-theme` or the `.dark` class (grep of `apps/web/src`); theming is `prefers-color-scheme` plus an unused override hook | a per-user preference store (client localStorage is enough for theme; for cross-device, `PUT /me/preferences`, see designs) | #195, #196 |
| 01 | Header: account menu (avatar initial) | wrong | An email string plus a "Sign out" button (`LibraryView.tsx`); no menu, no initial | none; the bookplate name needs a display name, see Opened book | #195, #196 |
| 01 | Stats line: "24 papers, 6 topics, 3 reading now, 484 pages" | missing | Not rendered. Papers and pages are computable from `/papers`; "topics" and "reading now" are not | topics + reading state | #195, #196 |
| 01 | "N need a look" popover and Table filter | missing | Not rendered. The states that should count are derivable now: `processing in {queued, reading, failed}` (frame shows LoRA "still being read" and SuperGLUE "could not read"). `partial` is ambiguous (design is silent; recommend counting it, since it is "could not read some parts"; confirm with the owner) | none; derive client-side. Optional: `GET /papers?needs_look=1` is not needed | #195, #196 |
| 01 | Views Shelf / Topics / Map / Table tabs | missing | One view, with a Cards/List toggle persisted in localStorage `papertree/library/layout` (`LibraryView.tsx:56`). The "List" view is the nearest thing to Table but is a stacked list, not a sortable table (`PaperList.tsx`) | none for tabs; see each view | #195, #196 |
| 01 | Arrange by (Topic, ...) | missing | Not present; only order is `addedAt` desc (`LibraryView.tsx` sort) | arrangement keys needed: topic (topics data), year, title, pages, last opened (needs last-opened), added | #195, #196 |
| 01 | READING NOW strip with progress bar, "p. 4 of 15", Continue | missing | Not present, and the data does not exist: `readingProgress` is a view-model field hard-coded to `0` (`library/types.ts:31, 128`), never filled from the wire (`libraryPaperFromWire`). Position lives only in the browser, see Reading progress | server-stored reading position + last-opened, see designs | #195, #196 |
| 01 | Catalogue card (hover/focus on a spine) in the band above the shelf | missing | none | title, authors, year, pages, topic, reading state all come from the above | #195, #196 |
| 01 | The shelf: rows per topic, spines, bookends, label holders with counts | missing | none | topic membership | #195, #196 |
| 01 | Spine ribbon on "reading now" | missing | none | reading state | #195, #196 |
| 01 | Footer hints: arrows along the shelf, Enter takes it down, Esc puts it back, Got it | missing | no keyboard handlers in the library (`grep keydown` over `components/library`, `app/dashboard`: none) | none | #195, #196 |
| 01 | Footer: "Drop PDFs anywhere to add them" | partial | Drop works only on the dashed zone (`UploadDropzone.tsx` `onDrop` on the zone's own element, ~line 296); there is no window-level drop target | none | #195, #196 |
| 01 | Footer: "topics suggested from arXiv categories, accepted by you" | missing | no topic feature, see Topics | topics | #195, #196 |
| 01 (state 2) | Typing "atten": shelf dims non-matches in place, never reorders; "2 of 24" counter; "Enter take down the first", Esc clear | missing | no search. Note a product-truth risk: the design says search never reorders, the v0.1 list sorts by recency and any new filter must not | none; client-side | #195, #196 |

## Frame 01b (empty library)

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 01b | Empty shelf with "accession slip": Drop PDFs here or choose files | partial | An empty state exists (`SystemStates.tsx` `EmptyLibrary`, used when `!hasPapers`, `LibraryView.tsx`) but it is the v0.1 pattern, not the accession slip, bookends or walnut plank | none | #196 |
| 01b | "No papers yet" in the stats slot, tabs still shown | missing | tabs absent | none | #196 |
| 01b | Note: "Each paper opens in Source mode straight away. Guided, Explain and the board follow when reading finishes." | partial | The same promise is made in v0.1 copy (`PROCESSING_DETAIL`, `types.ts:55`: "The PDF is already readable in Source mode"); the behaviour is true (Source mode is never gated, `derivedFeaturesReady`) | none | #196 |

## Frame 01c (3 papers, face-out covers)

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 01c | Face-out covers (typographic cover, topic cloth colour), progress bar and Continue/Open under each | missing | v0.1 cards instead (`PaperGrid.tsx`). Cards show: title, authors "+n more", pages, Added date, highlight count, state pill, Delete. No topic, no progress | topics, reading position | #196 |
| 01c | "Read" (finished) vs "Continue" distinction | missing | There is no "finished" notion stored anywhere. The table frame (01d) also needs "Read / Not started / Reading now" as three states. Only the browser's saved position exists | reading state needs `last_page`, `max_page`, `page_count` or an explicit finished marker, see designs | #196 |
| 01c | Delete lives in the card in v0.1 | wrong (vs design) | The design shows no Delete on the shelf (Remove appears only on the failed row in the Table). v0.1 has a one-click inline-confirmed Delete on every card (`PaperActions.tsx`, `remove` in `LibraryView.tsx`) | none; where Delete moves is a design question (Table "..." menu in 01d) | #196 |

## Frame 01d (Table view and "2 need a look" state)

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 01d | A real sortable table: Title, Authors, Year, Topic, Pages, State, Highlights, Last opened | missing | `PaperList.tsx` is a `flex` list of rows, not a table, no sort, no headers | `year`, `topic`, `last_opened_at`; others served | #197 |
| 01d | Authors cell with full-author popover | partial | `authors[]` complete in `/papers` (7 for Attention), the card truncates to "+n more" | none | #197 |
| 01d | Topic cell "Transformers & attention / arXiv cs.CL accepted" | missing | needs topic + source + accepted flag | topics | #197 |
| 01d | Highlights column | exists (data) | `highlight_count` is served (Attention 1) | none | #197 |
| 01d | Last opened column | missing | no field, no write anywhere | `last_opened_at` | #197 |
| 01d | State column: Reading now p. 4 of 15 / Read / Not started / Reading (readable in Source mode now) / Could not read, Retry, Remove | partial | The processing states and Retry/Remove exist (`PaperActions.tsx`; `POST /papers/{id}/retry`, `DELETE /papers/{id}`); "Reading now / Read / Not started" do not exist | reading state | #197 |
| 01d | Filter chips: All / Reading now / Read / Not started / need a look; Filter: topic, year, pages; Columns menu | missing | none | none beyond the fields above | #197 |
| 01d | Row action arrow, row "..." menu | missing | none | none | #197 |

## Frame 01e (Map: "Plan of the reading room")

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 01e | Topic islands (circles) with member papers | missing | none | topics | #198, #194 |
| 01e | Legend: topic you accepted / "Papers you linked on a board" line / reading now | missing | none | topics; board links, see next row | #198, #194 |
| 01e | Real links only: a line between two papers appears only when you link them on a board | partial | The data exists but only per paper: a board is per paper (`GET /papers/{id}/board`), nodes carry a `source_anchor`; an edge between two papers needs a **board node that references another paper**, and the `canvas_nodes` schema is per-paper. Whether a node can point at another library paper was not found in any route (**NOT CONFIRMED** in the board payload; A-board agents own the board audit). No library-wide "links" read exists | `GET /library/links` over board nodes that cite a second paper, or a cross-paper edge table, see designs | #198, #194 |
| 01e | Reference matches between papers as an alternative real-link source (ADR-004 2.3: "shared references matched by arXiv id or title, each labelled with how it matched") | missing | Data check below: the demo library has only two real citation links, both matchable by **title text only**, none by arXiv id | `GET /library/links?source=references` with a `matched_by` label, see designs | #198, #194 |

### Which demo papers cite each other (verified in the DB)

Counted from `papers.references_json` (entries are `{reference_entry_block_id, year?, arxiv_id?, confidence}`; the entry text is in `blocks.text` at that block id). References carry **no title and no author fields**, only the entry block id, an optional year and an optional arXiv id.

| Citing paper | Cites (demo library) | Matchable by arXiv id? | Matchable by title? | Evidence |
|---|---|---|---|---|
| Attention Is All You Need | ResNet (He et al., "Deep residual learning for im-age recognition", entry `[11]`) | no: ResNet's id 1512.03385 is not on that entry | yes, but only by free text; the entry is hyphenated across a line ("im-") | blocks.text of the entry, per-user query |
| BERT (users reader@, you@) | Attention Is All You Need | no | yes (Vaswani... "Attention is all you need") | blocks.text |
| DDPM | Attention Is All You Need | no | yes (entry ends "Attention is all you need. In Advances in Neural Information Processing Systems ... 2017") | blocks.text |
| YOLO, ResNet | none of the other four | no | no | no hits for the five titles |

For the **demo account** (Attention, DDPM, ResNet, YOLO): two links, Attention to ResNet and DDPM to Attention. In the whole `references_json` of the demo account's papers, 45 of 306 reference entries carry an `arxiv_id`, and none of the arXiv ids of the four demo papers (1706.03762, 2006.11239, 1512.03385, 1506.02640) appears among them. So an **arXiv-id match yields zero links on the demo data; a title match yields two.** A label like "cites it (matched by title)" is accurate; "matched by arXiv id" would never fire here. Never "similar paper" edges; nothing in the code produces similarity.

The reference parser keeps year and arXiv id only (`services/document-worker/.../references.py`). To match by title the server must either normalise `blocks.text` of the entry (de-hyphenate "im-age", fold ligatures such as "uniﬁed") or the parser must emit a `title` for the entry. That is a parser or API change, not a front-end one.

## Frame 01f (shelf at scale, +n more bookends)

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 01f | One row per topic with "28 of 36 shown, scroll sideways" and a "+8 more" bookend | missing | The shelf layout is a pure front-end function per ADR-004 2.3 and is not written | topics | #196 |
| 01f | Stats line without "pages" at scale | missing | n/a | none | #196 |
| 01f | `[sample] 120 papers` is a design annotation, not a feature | n/a | the frame's blue tag | none | #196 |
| 01f | Performance at 100-400 papers | NOT CONFIRMED | `GET /papers` has no pagination and no cap; it issues one row per paper with a job join (`papertree_db.library`). Not measured. v0.1 polls the list every 2 s while any row is queued/reading (`LibraryView.tsx` `POLL_INTERVAL_MS`), which at 120 rows re-sends the whole list | optional: `?updated_since=` for the poll | #196 |

## Frame 02a (book pulled out) and 02 (book open)

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 02a | Pull-out interaction (Enter takes it down, Esc puts back), typographic cover | missing | none | none | #200 |
| 02a | Variant cover using the paper's own Figure 1 | partial | The data exists: for Attention the parser holds 6 `figure` blocks and the Figure 1 caption `blk_jlkncbwok3ehjqth` ("Figure 1: The Transformer - model architecture.") on page_index 2 (p. 3) with figure block `blk_dsibp5ju4rblkcpa` 219x322 pt. `GET /papers/{id}/assets/figures/blk_dsibp5ju4rblkcpa` returned 200, `image/png`, 112,052 bytes (bearer). Nothing connects a figure block to its caption and nothing says "this is Figure 1" | `GET /papers/{id}/figures` listing figure blocks with caption text and page, see designs | #200 |
| 02 | Bookplate "EX LIBRIS: From the library of <name>" | missing | There is no display name: `users` has `user_id, email, created_at` only, and `/auth/me` returns `{user_id, email}`. The frame says "Mrigesh". Options: derive from the email local-part (`demo`), or add a `display_name` | `users.display_name` (nullable), `PATCH /auth/me`, return it from `/auth/me` | #200 |
| 02 | Bookplate: topic, arXiv id, "PaperTree · shelved 15 Oct 2026" | partial | shelved date = `created_at` (served). arXiv id is stored per paper (`papers.metadata.arxiv_id.value`, e.g. `1706.03762`, with `source_block_id`) but **not exposed by `/papers`**; topic missing | expose `arxiv_id` in `LibraryPaper` | #200 |
| 02 | "Use Figure 1 (p. 3) as the plate" (optional) | missing | person's choice must be stored | `plate` choice per paper, see designs | #200 |
| 02 | Meta line: "2017 · arXiv 1706.03762 · 15 pages" | partial | pages and arXiv id exist as above; year in the DB is **2023** for Attention (see Risks) | fix `year` | #200 |
| 02 | "5 figures · found Figure 1 (p. 3), Figure 2 (p. 4)" | partial | The parser finds 6 `figure` blocks (Figure 2 is two blocks: `blk_q7d5zr6o63eyjhjp`, `blk_75vfyglfaxdbyinl`, page_index 3) and 5 captions that begin "Figure n" (1-5), so "5 figures" would be the caption count. Float detection is known to miss some (#103), so the text must say "found" and not claim completeness | `figures` list endpoint | #200 |
| 02 | Title in display type, authors in italics | partial | title, authors served | none | #200 |
| 02 | Abstract excerpt with "p. 1 . Abstract" tag | partial | `metadata.abstract.block_ids` exist (`["blk_u62x5dbkstwjubse", ...]`), and `GET /papers/{id}/blocks` serves blocks, but there is no abstract field on the list payload | optional: `abstract_excerpt` on a `GET /papers/{id}/card` response | #200 |
| 02 | "Reading now . p. 4 of 15" + progress bar | missing | no server reading state; browser-only | reading position | #200 |
| 02 | Counts: "3 highlights . 2 explanation threads . 1 notebook" | partial | highlights: `highlight_count` in `/papers`. Threads: `GET /papers/{id}/threads` returns a list (the Attention thread list is non-empty), so a count costs one request per paper (N+1 on the whole library); no count field. "Notebook": no notebook endpoint or table exists (grep of OpenAPI paths and migrations 0001-0005); frame 05 (notebook) is another agent's, but the count line depends on what it is | add `thread_count` (and `notebook_count` once defined) to `LibraryPaper` or to a single-paper card endpoint | #200 |
| 02 | Read button | exists (route) | `/paper/<id>/read` renders (`LibraryView.tsx` `openPaper`) | none | #200 |
| 02 | Summary button + "Summary ready (cached)" | partial | `GET /papers/{id}/summary` returns `{"state":"ready","summary":{...status:"complete"...}}` for Attention, so "cached" is truthful and cheap per paper. POST summary exists. The library has no summary button; again N+1 for a whole library, fine for one opened book | none (the opened book calls it for one paper) | #200 |
| 02 | arXiv link "arxiv.org/abs/1706.03762" | missing | not shown; id is in `metadata.arxiv_id` but not served | expose `arxiv_id` | #200 |
| 02 | Put it back (Esc) | missing | none | none | #200 |
| 02 | Topic line "Transformers & attention, suggested from arXiv cs.CL, you accepted" | missing | see Topics | topics | #200 |

## Frame 03 (Topics)

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 03 | Topic cards: banner (cloth pattern, ornament, or the paper's Figure 1), name, "7 papers . 203 pages . 2 reading now", mini shelf, source line | missing | Nothing in code, DB (no topic table in migrations 0001-0005; tables listed in the demo DB have no topic table) or API | the whole topic feature, see below | #198, #193 |
| 03 | "Suggested from arXiv cs.CL, cs.LG, cs.CV . you accepted" | missing | see arXiv category below | topics + categories | #198, #193 |

### Topics: what exists and what is missing (verified)

1. **The category is in the PDF but not in the database as a field.** Every demo paper's arXiv margin stamp is a `margin_note` block whose text is `arXiv:1706.03762v7  [cs.CL]  2 Aug 2023` (Attention), `arXiv:2006.11239v2  [cs.LG]  16 Dec 2020` (DDPM), `arXiv:1512.03385v1  [cs.CV]  10 Dec 2015` (ResNet), `arXiv:1506.02640v5  [cs.CV]  9 May 2016` (YOLO), `arXiv:1810.04805v2  [cs.CL]  24 May 2019` (BERT). The parser extracts only the id: `_ARXIV = re.compile(r"arXiv:\s*([0-9]{4}\.[0-9]{4,5})(v[0-9]+)?")` (`services/document-worker/python/papertree_document_worker/metadata.py:43`), and `metadata.arxiv_id` is `{value: "1706.03762", source_block_id: "blk_464nph6sx2bt77oe", confidence: 0.6}`. The category and the version are discarded, though the source block id is kept, so a category can be read back from `blocks.text` for the existing parses without re-parsing (no `metadata` change needed for the demo data; a parser change makes it automatic for new uploads).
2. **A paper without an arXiv stamp has no category** (the "GPT-3" long-form paper is listed in the repo corpus manifest as `arXiv:2005.14165`, but papers from other sources have none). Topic suggestion then needs a different signal: this is where the Flash call is needed.
3. **No topic storage.** No table, no route, no field. The UI must be able to say "you accepted", so acceptance is stored per user per paper.
4. **No Flash topic suggestion exists.** The agent service has tools for outline/sections/passages/search only (`routers/internal.py`), and no prompt for topics under `packages/prompts` (not found; **NOT CONFIRMED** against the whole prompts package, I looked for arXiv/topic names). A Flash call would take title + abstract + category and return a suggested topic name from the user's existing topics, or a new one; never auto-applied.
5. The design's rule is "suggested ... accepted by you": acceptance is an explicit user event. An un-accepted suggestion must not group the shelf; unsuggested papers need an "Unshelved" row.

## Frame 08a (phone library, 390x844)

Current-app screenshot at 390: `shots/08a-phone-library-current.png` (single-column card stack, header = wordmark + Sign out, no search, no tabs).

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 08a | Search first, under the header | missing | no search | none | #199 |
| 08a | Stats line, "N need a look" under the title | missing | none | none | #199 |
| 08a | Segmented tabs Shelf / Topics / Map / Table, full width | missing | none | none | #199 |
| 08a | Reading now with Continue (3 stacked rows) | missing | no reading state | reading position | #199 |
| 08a | Books lying flat in stacks, one stack per topic, under "Transformers & attention 7" holder; spine width varies; ribbon on spine | missing | none | topics, page count (served) | #199 |
| 08a | "+" Add papers in the header | partial | the dropzone is in the body; on a phone `<input type=file>` works (opacity-0 full-bleed input, `UploadDropzone.tsx`) | none | #199 |

## Frame 09a (lamp-lit library, dark)

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 09a | Full library in dark ("lamp-lit": same layout, state 1 and state 2) | missing (the v0.1 page does go dark with the OS: `shots/01-shelf-current-dark.png`) | The library has no dark design. The dark **tokens** exist (`packages/ui/src/styles.css:113` media query, `:145` `[data-pt-theme='dark']`), but the library page uses a different `pt-s3-*` token set (`LibraryView.tsx`; the ui styles carry a second `:root` block at line ~1710). Dark is only possible via the OS preference; there is no switch | a stored preference if the switch is to follow the person across devices | #199 |
| 09a | Theme switch in Aa | missing | grep: nothing sets `data-pt-theme` or toggles `.dark` in `apps/web/src`; `apps/web/tailwind.config.ts` has `darkMode: 'class'` per the CSS comment, but nothing ever adds the class | none (localStorage is enough) | #199 |

## Frame 12-prototype, steps 1-5 (library, search "atten", pull out, open, Read)

| Step | Status | Evidence |
|---|---|---|
| 1 library | missing | v0.1 grid instead of the shelf |
| 2 search "atten" (dims, 2 of 24) | missing | no search |
| 3 pull out | missing | none |
| 4 open (bookplate and info page) | missing | none; a card opens the reader directly |
| 5 Read | exists | clicking opens `/paper/<id>/read`, which renders |

---

## Reading progress (the Reading now / Continue / ribbon / "p. 4 of 15" chain)

What exists, verified in code:

- The reader keeps your place **in the browser only**: `localStorage["papertree/reader/<paper_id>"]` as `{v:1, mode, zoomMode, page, yPt, blockId?}` (`app/paper/[id]/read/ReaderWorkspace.tsx:92-140`, key named at line 22, written at line 330). It is in try/catch because it is a convenience. `page` is zero-based, `yPt` the offset in points.
- The library has a `readingProgress` field (0..1) on its view model, **always 0**, never read from anything (`library/types.ts:31, 128`).
- The server stores nothing about reading: no table or column among `paper_owners` (`paper_id, owner_id, source_hash, created_at, original_filename, byte_size, page_count, latest_job_id`), `papers`, `pages`, or the 0005 migration; no endpoint. Nothing records "last opened".

Consequences for the design, each of which is unmet:

| Needed by | Needs |
|---|---|
| "Reading now" strip (frames 01, 01f, 08a) | which papers are in progress |
| "p. 4 of 15" and the progress bar | last page (server or browser) and `page_count` (served) |
| "Continue" vs "Open" and "Read" in the table | a finished state; no existing signal |
| Ribbon on the spine | in-progress flag |
| Table "Last opened" | a timestamp written when the reader opens |
| "3 reading now" in the stats line | count of in-progress |
| The **progress rule** | undecided in the design files I read; owner default is not stated. A rule must be chosen: e.g. in progress = has a saved position and not at the last page; finished = reached the last page (or the user marks it). It must be a stored, testable function |

A browser-only option would work for a single device (the data is already written, key `papertree/reader/<id>`), and the library could read all keys with a `papertree/reader/` prefix, but it is not per-account: it would show the previous user's position after a sign-out/sign-in on a shared browser (the key is by paper id only, and demo users have different paper ids, so cross-user leaks are unlikely but a reinstalled app or another device shows nothing). The owner's design says the library is cross-device ("Continue"), so I recommend a server store, with localStorage as the write-through cache the reader already has.

## Library views and behaviours (summary table)

| Behaviour | Status | Evidence |
|---|---|---|
| Views Shelf / Topics / Map / Table | missing | one Cards/List toggle (`LibraryView.tsx`) |
| Arrange by | missing | none |
| Search filters in place, dims, never reorders, "2 of 24 match" | missing | none |
| "N need a look" (queued/reading/failed count) | missing | state is derivable client-side today |
| Drop PDFs anywhere | partial | drop on the zone only |
| Catalogue card above the shelf | missing | none |
| Keyboard along the shelf (arrows, Enter, Esc, "/") | missing | none |
| 01f per-topic rows with "+n more" | missing | none |
| Spine width from pages | partial | `page_count` served |
| Spine states | missing | see 00-strip |
| Upload progress, cancel, retry, failure sentences, offline state | exists | `UploadDropzone.tsx`, `failureSentence` (`types.ts:81`), `OfflineState`; these survive into v0.2 as behaviour |
| Polling while any row is unfinished, none otherwise | exists | `pollInterval` (`LibraryView.tsx:89`) |
| Sign-out clears the cached list | exists | `queryClient.clear()` in `signOut` |

---

## Backend designs needed

Repo rules applied to all of them: parse-derived rows are keyed to a generation and may die with it; user-owned rows are keyed to the paper in `paper_owners` and never die with a generation; every FK between owned tables includes `owner_id` (see the pattern in `infrastructure/migrations/0005_reader_release.sql`: `FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE`, `UNIQUE (owner_id, highlight_id)`, `STRICT` tables). **A user-owned row that points into the paper text stores an `Anchor` (`@papertree/anchoring`, Python twin `papertree_anchoring`), never a bare `block_id`.** A bare block id dies with a re-parse. Rows below that point at a figure therefore store an anchor.

Suggested migration file: `0006_library.sql` (next number; 0005 is the latest).

### D1. Reading state (needed for Reading now, Continue, ribbon, progress, Last opened, "N reading now")

Migration:

```sql
CREATE TABLE reading_state (
  owner_id      TEXT NOT NULL,
  paper_id      TEXT NOT NULL,
  last_page     INTEGER NOT NULL CHECK (last_page >= 0),     -- zero-based, as the reader writes it
  furthest_page INTEGER NOT NULL CHECK (furthest_page >= last_page),
  page_count_at INTEGER,                                      -- page_count when written, to detect a re-parse change
  mode          TEXT CHECK (mode IN ('source','guided','split')),
  opened_at     TEXT NOT NULL,                                -- every open
  updated_at    TEXT NOT NULL,
  finished_at   TEXT,                                         -- set when the progress rule says finished, or explicitly
  anchor_json   TEXT CHECK (anchor_json IS NULL OR json_valid(anchor_json)),   -- optional exact place, an Anchor
  PRIMARY KEY (owner_id, paper_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
```

API:

- `PUT /papers/{paper_id}/reading-state`, body `{last_page:int>=0, mode?:"source|guided|split", anchor?:Anchor}`, response `204`; server sets `opened_at`/`updated_at`, raises `furthest_page`, sets `finished_at` per the rule. Errors: `404 not_found` (not this caller's paper), `422` bad page or `last_page >= page_count`, `401`. Called debounced by the reader (it already computes the position at `ReaderWorkspace.tsx:330`).
- Extend `LibraryPaper` (and `GET /papers`) with `reading: {last_page, furthest_page, page_count, opened_at, finished_at} | null` (`null` = not started). The library needs no extra request.
- Progress rule, to be decided with the owner and kept as one server function: suggested "reading now" = has a row and not finished; "read" = `furthest_page >= page_count - 1` or explicit "mark read"; "not started" = no row.

Corpus test: Attention (`1706.03762`, 15 pages) for p. 4 of 15, DDPM (25 pages) for p. 9 of 25 (the frame values), and YOLO (10 pages) for finished.

### D2. Topics (accepted, with source) and suggestions

Migration:

```sql
CREATE TABLE topics (
  topic_id   TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  cloth      TEXT,                    -- one of the cloth/tint ids from the design system
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, topic_id),
  UNIQUE (owner_id, name)
) STRICT;
CREATE TABLE paper_topics (
  owner_id     TEXT NOT NULL,
  paper_id     TEXT NOT NULL,
  topic_id     TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('arxiv_category','flash_suggestion','manual')),
  source_detail TEXT,                 -- e.g. 'cs.CL' or the model id
  status       TEXT NOT NULL CHECK (status IN ('suggested','accepted','rejected')),
  decided_at   TEXT,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (owner_id, paper_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, topic_id) REFERENCES topics (owner_id, topic_id) ON DELETE CASCADE
) STRICT;
```

No anchor here: a topic belongs to the paper, not to text. (The arXiv category evidence is a derived fact, not a user-owned pointer, so it is re-derived rather than stored as a block id.)

API:

- `GET /topics`: `[{topic_id, name, cloth, paper_count, page_count, categories:["cs.CL","cs.LG"]}]`.
- `POST /topics` `{name, cloth?}`, `201`; `409 topic_exists`.
- `PATCH /topics/{topic_id}`, `DELETE /topics/{topic_id}` (papers go to Unshelved), `204`.
- `GET /papers/{paper_id}/topic-suggestion`: `{status:"none|suggested|accepted|rejected", topic:{...}|null, source:"arxiv_category|flash_suggestion|manual", source_detail:"cs.CL"|null, arxiv_category:"cs.CL"|null}`.
- `PUT /papers/{paper_id}/topic` `{topic_id | new_topic_name, accept: true}` sets `accepted`; `DELETE` removes. `404`, `409`, `422`.
- Extend `LibraryPaper`: `topic: {topic_id, name, source, source_detail, status} | null`, `arxiv_id`, `arxiv_category`, `year`.

Suggestion logic: (1) deterministic first: category from the stamp, with a user-editable mapping `cs.CL -> Language & embeddings` or the person's own existing topic that already holds papers of that category; (2) a Flash call only when there is no category or no matching topic. Prompt input: title, abstract (`metadata.abstract.block_ids`), category, the person's existing topic names. Output: `{topic_name, is_new:boolean, reason}`. Result stored as `status='suggested'`, `source='flash_suggestion'`; it never groups the shelf until `accepted`. Cost note: one short Flash call per upload, not per page load.

Parser change (small): keep `[cs.CV]` and the version: extend the regex at `metadata.py:43` to `(\[([a-z\-]+(?:\.[A-Z]{2})?)\])` and add `arxiv_category` + `arxiv_version` to `metadata`; backfill existing generations by reading the stamp block's text (the source block id is already stored in `metadata.arxiv_id.source_block_id`), no re-parse needed.

Corpus test: the five papers above: expected categories cs.CL (Attention, BERT), cs.LG (DDPM), cs.CV (ResNet, YOLO). Note that the frame 03 mapping "ResNet and YOLO in Vision & detection" is consistent; but frame 03's "Neural ODEs, GANs under Generative models with stat.ML" shows that category does not map 1:1 to a topic, so the person's acceptance is the real grouping.

### D3. Library facts the list is missing (cheap, no new tables)

Extend `LibraryPaper` (`schemas.py:402`) and `papertree_db.library`'s query with: `year`, `arxiv_id`, `arxiv_category`, `thread_count`, `has_summary`, `figure_one: {block_id, page_index} | null`. All except `thread_count`/`has_summary` come from `papers.metadata` of the promoted generation and `blocks`. Returns `null` for a paper with no promoted generation (still being read). Error cases: none new.

`year` fix: the parser stores the year of the **stamp date** (latest arXiv version): Attention 2023, BERT 2019, YOLO 2016, but the design shows the paper's own year (2017, 2018, 2015). The arXiv id itself encodes the first-submission month (`1706.` = June 2017; `1810.` = October 2018; `1506.` = June 2015), which is the correct "year first published" for an arXiv paper. Derive `year_first = 2000 + int(id[:2])` for arXiv ids (valid for ids 0704-and-after; the new-style id scheme starts in 2007), and show the stamp year only if there is no id. This is a one-line change in `metadata.py:_find_year`, but it is a **parser behaviour change that bumps the parser version**, which triggers the reparse rules; a read-time derivation in the API avoids that.

### D4. Reading-status derived counts for the header ("3 reading now")

None beyond D1: derive client-side from `reading` on each row.

### D5. Display name for the bookplate and the account menu

```sql
ALTER TABLE users ADD COLUMN display_name TEXT;      -- nullable
```

`GET /auth/me` returns `{user_id, email, display_name}`. `PATCH /auth/me` `{display_name: string 1..60}`, `200`/`422`. Until set, the bookplate must say what it can truthfully say: the email's local part is a guess ("demo"), so I recommend asking once ("Whose library is this?") instead of inventing. Note `users.email` is unique-indexed (`users_email_unique`); `display_name` is not.

### D6. Plate choice (Figure 1 as the plate)

```sql
CREATE TABLE paper_plate (
  owner_id   TEXT NOT NULL,
  paper_id   TEXT NOT NULL,
  anchor_json TEXT NOT NULL CHECK (json_valid(anchor_json)
                 AND json_extract(anchor_json,'$.doc.paperId') = paper_id),   -- an Anchor on the figure, not a block_id
  chosen_at  TEXT NOT NULL,
  PRIMARY KEY (owner_id, paper_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
```

- `GET /papers/{paper_id}/figures` -> `[{block_id, page_index, bbox, caption_text|null, caption_block_id|null, label:"Figure 1"|null, asset_url}]` (asset URL via the existing signed `/assets/figures/{block_id}`). `404`.
- `PUT /papers/{paper_id}/plate` `{anchor}` `204`; `DELETE` reverts to the typographic cover.
- Default stays the typographic cover (#103: float detection misses some figures); the offer "Use Figure 1 (p. 3) as the plate" is shown only when the figures list includes a block whose caption starts "Figure 1".

Corpus test: Attention, figure `blk_dsibp5ju4rblkcpa` (p. 3), caption `blk_jlkncbwok3ehjqth`; plus one paper with no detectable Figure 1 to prove the offer hides (a re-run on YOLO/ResNet is needed, **NOT CONFIRMED** which of them lacks a caption-matched Figure 1; I did not run that query).

### D7. Real links for the Map

Two honest sources, both labelled with how they matched.

1. Board links: no table exists for a link between two papers (`canvas_nodes`/`canvas_edges` are per paper). If a node may reference another library paper, an edge between those nodes is the "papers you linked on a board". Needs: `GET /library/links?kind=board` -> `[{from_paper_id, to_paper_id, via:"board", board_id, edge_id}]`. Whether the board can hold a cross-paper node is NOT CONFIRMED (boards audit).
2. Citation matches: `GET /library/links?kind=citation` -> `[{from_paper_id, to_paper_id, matched_by:"arxiv_id"|"title", reference_block_id}]`, computed from `papers.references_json` + entry text, de-hyphenated and ligature-folded, exact normalised-title match only; ignore anything fuzzy. Since `matched_by:"arxiv_id"` produced **0 links** and `"title"` **2 links** on the demo corpus, the label text must come from the field, not be assumed.

A reference-entry `reference_entry_block_id` is a parse-derived pointer: fine in a derived response, **not** to be stored in a user row.

### D8. Optional: preferences (theme, Aa settings)

`GET/PUT /me/preferences` `{theme:"light|dark|system", reader:{...}}`. Needed only if the theme switch should follow the person across devices; localStorage alone is enough for v0.2 if the owner accepts per-browser.

---

## v0.1 defects in my area (#175)

| Defect | Status | Evidence |
|---|---|---|
| "Upload row separators" | still present (the list is unchanged in structure), will be removed by the new design | `UploadDropzone.tsx` renders the queue as `<ul data-testid="upload-queue">` of `<li>` rows with `pt-s3-alert` styling; `PaperList.tsx:38` uses `border-b ... last:border-b-0`. Neither survives in the shelf design, but the upload queue itself is not drawn in any frame, so its replacement is **undefined**: the 'Add papers' button's progress surface needs a design |
| A layout shift when the "still being read" banner leaves | NOT CONFIRMED (needs a paper in `reading` state to observe; the demo data has none) | The v0.1 page has `SessionBanner` and per-card state text; the shift would come from the card growing and shrinking between `parsing` and `complete` (step text "step n of 3", `types.ts` `step`). The new design has no banner: a kraft wrap on the spine is fixed-size, which would remove the shift by construction, if the spine width does not change when `page_count` arrives (it is 0 until the parse sets it, `types.ts:28`; a width that reflows when the count arrives is the same defect). Reserve a default width |

## Risks and surprises

1. **The library is v0.1, not partly v0.2.** Everything in the frames is a new build; the only reusable pieces are the data layer (`GET /papers`, polling, upload, retry, delete, sign-out clearing) and the state mapping. Ship order matters: D1, D2, D3 first, because the Shelf, Topics, Map, Table, Reading now, the catalogue card and the opened book all depend on them.
2. **Years on spines would be wrong.** The parser stores the year of the arXiv stamp date, which is the latest version's date: Attention 2023 (design 2017), BERT 2019 (design 2018), YOLO 2016 (design 2015); DDPM 2020 and ResNet 2015 are right by luck. Spine years drawn from `metadata.year` contradict the design and the papers' real publication years. Use the arXiv id prefix, or fix the parser.
3. **`metadata.arxiv_id.confidence` is 0.6 and the category is thrown away.** The regex keeps id and drops `[cs.CL]`, but the source block id is kept, so a backfill needs no re-parse. If the arXiv stamp is missing (non-arXiv upload), topics fall back to the Flash suggestion; a Flash suggestion must never auto-place a paper.
4. **No display name.** The bookplate's "Mrigesh" cannot be produced from the account. Do not synthesise a name from the email.
5. **"Notebook" in the counts line is undefined on the backend**: no table, route or count exists, though frame 05 draws a notebook. Resolve with the notebook auditor before adding a count.
6. **Reading state is browser-only**, keyed by paper id; "Continue" across devices is impossible today, and "Read" vs "Not started" has no data at all. The progress rule has to be written down and tested.
7. **Thread and summary counts are per-paper calls**: showing the line for every book on the shelf would be N+1; compute them only for the opened book, or add counts to the list payload (D3).
8. **Map links are thin on real data.** On the demo account only 2 true citation links exist (Attention to ResNet, DDPM to Attention), found by title; the id route finds none. The map will look sparse unless the owner links papers on boards, and "similar paper" edges are forbidden. An empty Map is the honest state; the frame's legend already says "none yet".
9. **Theme**: dark tokens exist but there is no switch, and the library uses a separate token set, so a "lamp-lit" library needs both a switch and a decision on which token set wins.
10. **The shared dev web server dropped the dashboard route's chunk for several minutes** (404 on `/_next/static/chunks/app/dashboard/page.js`), then recovered on its own. Suspected cause: three agents driving one `next dev`; not verified.
11. Frame annotations ("fold . 900", "[sample] 120 papers: 24 real + 96 untitled") are design commentary, not features. Note 01f's 96 "untitled" papers: a paper whose title block is empty falls back to the filename then the paper id (`library.py:title_for`), so the shelf will meet titles like `yolo-1506.02640` rather than "Untitled"; the spine needs a rule for that.
