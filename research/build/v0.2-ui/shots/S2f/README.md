# S2f shots (#197): the Table view and "need a look"

Taken at 1440 × 900 and 390 × 844 (touch) from the S2f branch, `next dev`, against a copy of the v0.2 data on
S2f's own servers (web 18905, API 18906, the real worker). One account, built through the API: the thirteen
corpus and fresh PDFs but Neural ODEs, plus one garbage PDF (could not be read); topics accepted as a person would
(the first paper of an arXiv category named by hand, "chosen by you"; the rest accepting the category's offer,
"arXiv cs.CL · accepted"); Attention p. 4, FlashAttention p. 3 and DDPM p. 9 opened, YOLO and ResNet finished,
through `PUT /papers/{id}/reading-state`. Then the worker was stopped and Neural ODEs uploaded, so it really is
queued (it shows its file name, "neural-odes-mathheavy", because nothing has read its title yet). No highlights
were made, so the Highlights column is all dashes.

`compare-*` put the frame (left) beside the build (right), at half size: the top of the page with a lit row and
its authors popover open, and the frame's second state ("2 need a look" applied).

| File | What |
| --- | --- |
| `01d-table-1440-{light,dark}.png`, `01d-table-1440-light-full.png` | the Table tab, sorted by topic then title |
| `01d-lit-row-1440-light.png` | a hovered row (navy rule, arrow and "…") with "Authors · full" open |
| `01d-need-a-look-1440-{light,dark}.png` | "2 need a look" from the title: All and the pressed chip, the sentence, two rows |
| `01d-table-390-{light,dark}.png`, `01d-need-a-look-390-light.png` | phone: the table scrolls sideways in its own region, the Title about 58% of the screen |
| `01d-focused-row-scrolled-390-{light,dark}.png` | phone: a focused (and a hovered) row with the table scrolled 300 px: the pinned title stays opaque |
| `01d-last-row-menu-390-light.png` | phone: the last row's "…" menu, placed on the screen and opened upward (the table scrolled to its end) |
| `01d-filter-390-light.png`, `01d-filter-320-light.png` | phone: the Filter panel opens rightward, inside the screen |
| `compare-01d-light.png`, `compare-01d-need-a-look-light.png` | frame beside build |

The 1440 shots and the comparisons are from before the review: nothing they show changed. The phone shots were
taken again after it, from a fresh copy of the data on the SSD, the account seeded the same way.

axe (wcag2a/aa, 21a/aa, 22aa, every rule including colour contrast) on the whole page: the Table and "need a
look" applied at 1440 and 390, and at 1440 also with an authors popover open and with a row's "…" menu open, light
and dark: **0 violations of any impact** (12 runs). `document.documentElement.scrollWidth` equals the viewport at 320, 390
and 1440: only the table's own region scrolls sideways on a phone. The first 390 run found the page 1067 px wide:
the screen-reader-only text in the cells is absolutely placed and escaped the scrolling region; the region is now
positioned (`table.css`).

After the review (`shots2.mjs` in the scratch folder): axe, every rule, on the whole page at 1440 and 390, light
and dark, on the Table, with the authors popover (1440), the last row's "…" menu, the Filter and Columns open, and
"need a look" applied: **0 violations in 22 runs**. Measured: the phone Title column is 226 px at 390 (it was
138) and 186 at 320; the pinned title on a focused row is opaque (`color(srgb 0.905 0.884 0.843)` light); the last
row's menu is `position: fixed` at 589–735 of an 844 px screen, over its button; Tab six times from an open menu
leaves no menu in the page; the Filter panel spans 16–374 px at 390 and 16–304 at 320; no page scrolls sideways
at 320, 390 or 1440.

The e2e `e2e/v02/library-table.spec.ts` (now two papers with known years, so the Year order shows its reversal)
was run against these servers with a scratch Playwright config (no `pnpm e2e`, no servers of its own): 1 passed.

## Performance at 400 rows (no virtualisation, ADR-004)

Production build (`next build`, `next start`), Chromium, 1440 × 900; the account's own `GET /papers` rows repeated
under new ids to 400 by a Playwright route on that one request (as S2e did). Each number is the in-page time from
the action to the next animation frame after it (React's render, style, layout and paint), three runs. Load
average 6–12 during the runs.

| | 400 rows |
| --- | --- |
| open the Table tab (400 rows mount) | 96–142 ms |
| sort by Year, and again (400 rows reorder) | 48–69 ms |
| a search keystroke ("a" … "atten", then back; rows filter out and back in) | 6–50 ms, median 16 |
| chip "Read" (rows leave) / "All" (they return) | 10–15 / 56–95 ms |
| back to the Shelf | 47–52 ms |
| scrolling the whole table, 40 px a frame (588 frames, 23,492 px) | median 16.7 ms, p95 17.8–18.2, max 18.1–22.2; **0 frames over 33 ms** |

Scrolling holds 60 fps. Opening, sorting and "All" are one-off costs over a frame (every row mounts or moves); a
keystroke is around a frame, with a 50 ms worst case. Not measured again after the review, whose changes only
take work away: one `Intl.Collator` for every compare (the review measured 6.9 ms against 0.19 ms per 400-row
sort in node), and a poll re-draws only the rows whose paper changed (it re-drew all of them).

## Deliberate deviations

- **"N need a look" opens the Table filtered** (the owner's default for this slice); before, it filtered the
  shelf. It stays a toggle: pressed while the Table shows those papers; pressing it again shows All.
- **The chips count what the search and the Filter leave**, so a chip's number is the rows it shows ("Not
  started 1" under the search "atten" shows one row). The states still add up to All, as in the frame (24 = 3 +
  10 + 9 + 2): they partition any set of papers, and with no search or filter both readings print the frame's
  numbers. The title's "N need a look" counts the whole library. A queued paper is "Queued · Readable in Source
  mode now" and, like one being read, counts only under "need a look".
- **In the "need a look" state the Filter button and the sort caption stay** (the frame's second state draws
  only the chips and the sentence); they still apply.
- **The sentence** names the papers by their short title ("garbage could not be read."); the frame's "could not
  be read as a PDF" is left out, because the reason is the failure sentence on the card and is not in the list's
  data per paper. Past three papers it counts them.
- **Ties sort by title**, both ways, so "Sorted by topic, then title" is literal; within a topic the frame's
  rows are in shelving order, not by title.
- **The row's arrow is a pointer's second way in** (`tabindex="-1"`): the title is a link to the reader, so a
  keyboard row has one stop for it, not two. The "…" menu has Open too.
- **Remove's confirmation** is the catalogue card's, in a row of its own under the paper; it now takes focus on
  "Keep it" when it appears, in the card as well (the button that opened it disappears, and focus used to fall to
  the page and be put back on the spine). "Keep it" returns focus to what opened it: the card's Delete, the row's
  title.
- **Authors with three or more names** are a dotted-underlined button (the popover's affordance); the frame draws
  them as plain text.
- **"—" in a cell** is read as "unknown", "none" or "never" by a screen reader; the brief's "never" for Last
  opened is that word, and the page shows the frame's dash.

## Remaining differences from 01d

- 15 papers, three topics, not 24 and six; topics sort by name (Generative models first), the frame by the
  designer's order. Parser readings show as they are: "Abstract" (the A3C PDF's title), BERT's authors
  "Language Understanding", no authors found for Sentence-BERT, and the queued paper's file name.
- Year and Pages are 76 px wide, not 60–62, so a sorted header's chevron fits; the Title column is 28 px narrower.
- The lit row's wash is a mix of the rule colour, slightly greyer than the frame's slip-paper tint.
- The title row's "2 need a look" has no chevron (S2d's alert); the frame draws one, as if it opened a menu.
- No highlights in the account, so the Highlights column shows no number (Attention shows 3 in the frame).
- Phone (no frame for the Table at 390): the table keeps its columns and scrolls sideways in its own region, with
  the titles (about 58% of the screen, up to three lines) held at the left; chips, Filter and Columns wrap above
  it, all 44 px.
