# book

A book taken off the shelf and opened (#200; frames 02a, 02 and 11; DESIGN.md §1, §6).

- **Pull out (02a).** Enter on a book whose parse is in (a spine, or a face-out cover) lifts it out of the row and
  turns it face-out over the veiled shelf; its slot stays as a shadowed gap (`data-pulled` on the spine). The cover
  is the typographic one in the topic's cloth ("2017 · arXiv 1706.03762" at its foot), or the paper's own figure
  once one is chosen as the plate. The slip under it says the state ("Reading now · p. 4 of 15") and "Enter open ·
  Esc put it back" (both are buttons too). A queued, still-being-read, failed or sample paper keeps Enter for its
  catalogue card, where Retry and Delete are.
- **The card and the pull-out.** A click (or Space) on a book still takes it down into S2d's catalogue card in the
  band above the shelf; the card of a book that can be opened gains **Open the book**, which goes straight to the
  spread. So the card is the mouse's way and Space the keyboard's way to Read / Retry / Delete, and Enter is the
  pull-out, as DESIGN.md §1 says. The key hints under the plank say "Enter take it out · Space its card".
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
- **Keyboard and focus.** The book is a modal dialog (`role="dialog"`, `aria-modal`), labelled by its title; Tab
  stays in it and the library behind is `inert`. Focus is on the cover when it comes out and on Read when it opens;
  Esc (anywhere) or "Put it back" puts it back, and focus returns to the book on the shelf. Esc while the book
  is still moving cancels the motion and wins: every animation's end checks the current moment (`moving` in
  `PulledBook`, the functional `onOpen` in `useBookOnShelf`), so a swing Esc cancelled never reopens the book. Choosing or clearing the
  plate moves focus to the button that replaces the one pressed.
- **Motion** (`model/motion.ts`, WAAPI over CSS 3D): pull out = lift 120 → turn 200 → settle 80 on the lift curve,
  starting at the spine's own box; open = the cover swings 480 while the spread comes up; put back 200; Read
  cross-fades 120. Reduced motion: every step is one 120 ms cross-fade with nothing moving (`data-motion`).
- **Phone (390).** The spread stacks (bookplate, then the details) and the dialog scrolls.

## Data flow

Shelf (`features/library/components/ShelfSection.tsx`) → `useBookOnShelf` (which book is out, and at which stage)
→ `PulledBook` → `BookSpread` → `useBookFacts` / `useDisplayName` / `usePlateChoice` (TanStack Query) → `bookApi`
/ `authApi` → `GET /papers/{id}/figures`, `GET /papers/{id}/abstract`, `PUT` / `DELETE /papers/{id}/plate`,
`GET` / `PATCH /auth/me` (services/api, `routers/book.py`) → SQLite (`paper_plate`, 0010; the plate is an Anchor).
The library row (`GET /papers`) carries everything else: the arXiv id, year, counts, `has_summary`, the topic and
the plate, which the covers draw. A plate change re-reads `['papers']`. The reader's half of the two links is
`hooks/useFromBook.ts` (`?from=book&at=abstract`, `?from=book&open=summary`).

## Key files

- `model/book.ts`: the bookplate's owner rule, the meta, figures, counts and topic lines, the Figure 1 offer, the
  excerpt, the plate's caption, which books can be opened (pure; `book.spec.ts`).
- `model/motion.ts`: the keyframes and timings, both paths (pure; `motion.spec.ts`).
- `components/PulledBook.tsx` (the dialog and its two stages), `BookCover.tsx`, `BookSpread.tsx`, `Bookplate.tsx`,
  `BookDetails.tsx`, `book.css`.
- `hooks/useBookOnShelf.ts`, `useBookData.ts`, `useBookMotion.ts`, `useFocusTrap.ts`, `useFromBook.ts`.
- Tests: `apps/web/test/book.spec.tsx` (through the library page), e2e `e2e/v02/book.spec.ts`.
