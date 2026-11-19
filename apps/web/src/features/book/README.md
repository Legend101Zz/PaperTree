# book

A book taken off the shelf and opened (#200; frames 02a, 02 and 11; DESIGN.md §1, §6).

- **Take out and open (v0.3 #337).** A click (or Enter, or Space) on a book whose parse is in, on any spine on any
  plank, takes it off the shelf and opens it in one motion: the spine slides out of its slot, turns to face you,
  flies to the middle growing into a cover, the cover swings open and you land on the spread. There is no card in
  between (the owner's catalogue card is gone). The slot stays a shadowed gap while the book is out (`data-pulled`
  on the spine). A queued, still-being-read, failed or sample paper cannot be opened yet: the shelf reads it
  instead (Retry and Remove are the Table's).
- **The spread (02).** Left, on patterned endpaper: the _Ex libris_ bookplate ("From the library of <name>", the
  topic, the arXiv id, "PaperTree · shelved 15 Oct 2026"), or the chosen plate with its caption. The name is
  `display_name`; without one the plate asks once, inline, "Whose library is this?" (Save stores it with
  `PATCH /auth/me` and focus moves to the name; "Not now" is remembered for that account in this browser,
  `papertree/book/name-declined/<user_id>`, the line is left out and a quiet "Name this library" (focused) asks
  again; the first Esc in a field with text clears the text, not the book). It never makes a name up from the
  email. The header's account initial is that name's once there is one, else the email's. Under it: "Use Figure 1 (p. 3) as the plate" when the parser
  found a figure whose caption starts "Figure 1" (with a crop and an Anchor), or "Use the typographic cover".
  Right: the topic and where it came from (the library's one `topicSource` rule: "chosen by you", "suggested from
  arXiv cs.CL · you accepted", "suggested by the AI (MiniMax-M3) · you accepted"), "2017 · arXiv 1706.03762 · 15
  pages", "5 figures found · Figure 1 (p. 3), Figure 2 (p. 4)" (the captioned figures the parser FOUND, never the
  paper's count: ResNet has 7 and 3 are found, #103), the title, the byline, the abstract's first whole sentences as the paper's
  words under a "p. 1 · Abstract" tab (a link: the reader flashes the abstract), where you are with the rule, the
  counts ("3 highlights · 2 explanation threads · 1 notebook page", zeros left out), **Read** (oxblood cloth),
  **Summary**, its words from `GET /papers/{id}/summary` when the book opens ("Summary ready (cached)" only for a
  complete summary of the current prompt, "Summary cached (partial: …)", "A summary is being written", or
  **Summarize** with "No summary yet"; it opens the reader's panel on the summary), the arXiv link and "Put it back
  (Esc)".
- **The spread's actions (v0.3 #337).** **Read** says **Continue at p. 4** once reading has started and resumes
  there (`useContinue`; the same place as Reading now's Continue). The **⋯** menu (`SpreadMenu`, a `role="menu"`
  with arrow keys; Esc closes the menu first, a second Esc puts the book back) has **Rename…** (the title becomes a
  field in place, Enter saves with `PATCH /papers/{id}`, Esc cancels, a blank title is refused in a sentence; the
  name is stored beside the paper, `paper_title` 0012, and wins over the parsed title everywhere the library shows
  one; the parsed title still feeds citation matching and the model's context), **Topic** (the person's topics with
  the current one ticked, and "No topic": `PUT` / `DELETE /papers/{id}/topic`; the shelf regroups behind the book
  and the way back flies to the spine's new place) and **Delete this paper** (no confirmation: the book closes in
  the 420 ms reverse, or just goes under reduced motion; the library hides the spine and offers Undo for 10 s, then
  sends the request: `usePendingDelete`). A paper that is not read in shows its status sentence in place of the
  abstract and asks the server for none of the facts: queued says it waits (Read opens the PDF in Source mode),
  being read has a disabled Read, failed has **Retry** (`useBookActions`) and **Remove** (the same Undo-able
  delete), partial reads and says what is missing.
- **Keyboard and focus.** The book is a modal dialog (`role="dialog"`, `aria-modal`), labelled by its title; Tab
  stays in it and the library behind is `inert`. Focus is on the dialog while the book moves and on Read when it is open;
  Esc (anywhere), a click on the veil or "Put it back" puts it back, and focus returns to the spine on the shelf.
  A click or ANY key (Esc included) while the book is still coming out skips to the end (the animations are
  finished, not cancelled), and a click that skipped is not also a click outside; a second Esc puts it back.
  Every animation's end checks the current moment (`moment` in `PulledBook`), so a put-back never reopens the book. Choosing or clearing the
  plate moves focus to the button that replaces the one pressed.
- **Motion** (`model/motion.ts`, WAAPI over CSS 3D): one sequence of 880 ms: slide out 120 → turn 160 → travel
  and grow 220 → cover swings 280 → settle 100, played on four elements together (the spine's cloth, the cover,
  the spread, the veil); put back 420 (the reverse); Read cross-fades 120. Reduced motion (and a spine that
  cannot be measured): one 120 ms cross-fade each way with nothing moving (`data-motion`).
- **Phone (390).** The spread stacks (bookplate, then the details) and the dialog scrolls. A phone reaches it
  by a tap on a flat book (the same motion, from the flat book's box; the cover covers the whole page). Below 900 px or on a touch
  screen the "p. 1 · Abstract" tab answers a 44 px tap (its link holds the clipped face, and the link's hit
  area reaches 12 px above and below), the arXiv link is 44 px tall, and "Put it back" draws no Esc key.

## Data flow

Shelf (`features/library/components/ShelfSection.tsx`) → `useBookOnShelf` (which book is out)
→ `PulledBook` → `BookSpread` → `useBookFacts` / `useDisplayName` / `usePlateChoice` (TanStack Query) → `bookApi`
/ `authApi` → `GET /papers/{id}/figures`, `GET /papers/{id}/abstract`, `PUT` / `DELETE /papers/{id}/plate`,
`GET` / `PATCH /auth/me` (services/api, `routers/book.py`) → SQLite (`paper_plate`, 0010; the plate is an Anchor).
The library row (`GET /papers`) carries everything else: the arXiv id, year, counts, `has_summary`, the topic and
the plate, which the opened book draws. A plate change re-reads `['papers']`. The reader's half of the two links is
`hooks/useFromBook.ts` (`?from=book&at=abstract`, `?from=book&open=summary`).

## Key files

- `model/book.ts`: the bookplate's owner rule, the meta, figures, counts and topic lines, the Figure 1 offer, the
  excerpt, the plate's caption, which books can be opened (pure; `book.spec.ts`).
- `model/motion.ts`: the keyframes and timings, both paths (pure; `motion.spec.ts`).
- `components/PulledBook.tsx` (the dialog, its three moments: opening, open, closing), `BookCover.tsx`, `BookSpread.tsx`, `Bookplate.tsx`,
  `BookDetails.tsx`, `SpreadActions.tsx`, `SpreadMenu.tsx`, `SpreadTitle.tsx`, `book.css`, `spread.css`.
- `hooks/useBookOnShelf.ts`, `useBookData.ts`, `useBookMotion.ts`, `useFocusTrap.ts`, `useFromBook.ts`.
- Tests: `apps/web/test/book.spec.tsx` and `book-actions.spec.tsx` (through the library page), e2e `e2e/v02/book.spec.ts`.
