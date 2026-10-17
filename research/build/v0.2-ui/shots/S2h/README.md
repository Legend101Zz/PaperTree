# S2h shots (#199): the phone library (08a) and the lamp-lit library (09a)

Taken at 390 × 844, 320 × 700 and 768 × 1024 (touch: `hasTouch`, `isMobile`, so `pointer: coarse`), and 1440 × 900, from the
S2h branch, `next dev`, on S2h's own servers (web 18905, API 18906, the real worker) against a copy of the v0.2 data
on the SSD. One account, built through the API: every corpus and fresh PDF (14), five topics made with
`PUT /papers/{id}/topic` (Transformers & attention 5, Vision & detection 3, Generative models 2, Language &
embeddings 2, Optimization & training 1; A3C left Unshelved), a 4-line garbage PDF that could not be read
("1 need a look", the torn label), and three places (`PUT /papers/{id}/reading-state`: Attention p. 4, DDPM p. 9,
FlashAttention p. 3). A copy of SBERT with one changed byte was uploaded once to catch kraft ("being read") on the
phone; it was deleted before the final shots, so kraft is seen in an earlier run only (it is covered by
`apps/web/test/library-phone.spec.tsx`).

"Full" shots grow the viewport to the page instead of using Playwright's `fullPage`, which re-emulates the device
for the capture and drops touch (the key hints then appear, as no phone shows them).

| File | What |
| --- | --- |
| `08a-library-390-{light,dark}.png` | the first screen: header, search, title and stats, "1 need a look", the tabs, Reading now, the first stack |
| `08a-library-390-{light,dark}-full.png` | the whole page: six stacks under their holders, the ribbons out of the fore-edge, the torn label |
| `08a-sheet-390-{light,dark}.png`, `08a-sheet-320-dark.png`, `08a-sheet-768-light.png` | after review: a book taken down, its card a modal bottom sheet over a scrim (Read focused, Delete, Put it back), the book pulled out and clear above it |
| `08a-spread-390-{light,dark}.png` | after the rebase onto S3 (#200): the sheet's "Open the book" opens S3's spread, stacked at 390 (Enter, Space and a tap open the sheet on a phone; no pull-out) |
| `08a-library-768-light.png` | after review: a 768 px tablet held upright is in the phone range: two stacks side by side |
| `08a-library-320-light-full.png` | 320 px: the header on two rows, two-line titles cut with "…", nothing sideways |
| `08a-search-390-light.png` | typing "atten": 5 of 15 lit (the topic's name matches too), the rest dimmed, nothing reordered; the clear button an × (after review) |
| `08a-map-390-light.png` | the Map on a phone: "The plan as a list" first and open, its papers 44 px links, then the plan |
| `09a-library-1440-dark.png` | the desktop in the lamp-lit scheme, unchanged by S2h |
| `compare-08a-light.png`, `compare-08a-dark.png` | frame 08a (left) beside the build at 390 (right), light and lamp-lit |
| `compare-09a-1440-dark.png` | frame 09a (left) beside the build at 1440 (right) |

**axe** (every rule, the whole page) at 320, 390 and 1440, light and dark: the shelf, a book taken down (the
sheet), a search, Topics, the Map and the Table: **0 violations of any impact in 40 runs.**
`document.documentElement.scrollWidth` equals the viewport in all 40. **Targets:** on the phone shelf, the Map and
the Table every visible control is at least 44 × 44 px (measured on every button, link, select, input and summary).
On Topics the topic names measure 29 px tall, but their `::after` covers the whole 358 × 340 card (a press on the
banner hits the name: `elementFromPoint` checked on three cards), so the target is the card.

**After the review** (`REVIEW.md` in the reviewer's scratch: SF1–SF5), on a fresh copy of the data and the same
account rebuilt: axe, every rule, whole page, at 320, 390, 768 (touch) and 1440, light and dark, in the shelf, the
sheet, a search, Topics, the Map and the Table: **0 violations in 32 runs**, no page wider than its viewport. At 768
the Map's "The plan as a list" and the Topics "Manage …" buttons are 44 px now (they were 40); every visible
control on the shelf, the sheet, the Map and the Table is 44 px or more at 320, 390 and 768. At 320 × 700 with the
sheet up, ↓ ↓ ↓ ↑, Tab × 4 and Shift+Tab all leave focus in the sheet, and its book stands clear above it (book
bottom 371, sheet top 481). Crossing 900 px in Chromium (1000 → 800 → 1000) with a card open: the pointer is back on
its book (373/372, 763/762, 736/735 px; before the fix 689/372 and 261/1009), the sheet was modal at 800 with focus
in it, and no `inert` is left; with focus on a paper in the Map's list, focus and the open list survive both ways.

**After the rebase onto S3** (`effe78c`), on a fresh copy of the data: axe, every rule, whole page, at 320, 390,
768 (touch) and 1440, light and dark, in the shelf, the sheet, S3's spread opened from the sheet (320, 390, 768), a
search, Topics, the Map and the Table: **0 violations in 38 runs**, no page wider than its viewport. The sheet shots
were retaken (they now carry "Open the book"). On S3's spread at the phone widths two links are under 44 px: the
"p. 1 · Abstract" tab (125 × 20, a clipped margin tab) and the arXiv link (186 × 41); both are S3's
(`features/book`), reported rather than changed here. Against S3's head, the base's `features/library` checked out
on the dev server (0 flat books served at 390): 12 views at 1440, light and dark (shelf, a card, the pulled and
opened book, Topics, the Map with its list, the Table), **0 pixels differ in all 12.**

**The desktop does not change:** the shelf, a card open, Topics, the Map with its list open and the Table at
1440 × 900, light and dark, were shot before (the branch's base, by `git stash`) and after: **0 pixels differ in all
10.** After the review, again (the base's `features/library` checked out on the dev server, 0 flat books served at
390, then HEAD): 0 pixels differ in all 10.

The e2e `e2e/v02/library-phone.spec.ts` was run against these servers with a scratch Playwright config (no
`pnpm e2e`, no servers of its own, a fresh account, sample papers off): **1 passed** (47 s, and 1.1 min on the final code). Its first run failed
at the reader, honestly: the reader's `topLine` helper cannot find a line at 390 (fit-width body text is under its
8 px floor), so the spec reads the page at the reader's top edge instead.

## Remaining differences from 08a

- **Short titles are the papers' own.** 08a prints DDPM, GPT-3, ViT, LoRA; those names are not in the titles, and
  the shelf never invents one (`spineTitle` is the text before a colon). So "Denoising Diffusion Probabilistic
  Models" lies on two lines and the Reading-now row cuts it with "…". A3C's parse gives the title "Abstract".
- **The header** keeps S2e's bordered Add papers and the Aa menu (08a draws a bare "+" and no Aa); the brief asks
  for Aa. At 320 it is two rows (the brand and three buttons, then the search).
- **Arrange by** stands under the tabs; 08a has none. Kept, because the arrangement is the stacks' grouping too.
- **Continue** has the shared row's arrow (S2e's `ReadingNowRow`); 08a's has none.
- **Lengths** are 08a's (274 + 1.12 × pages on its 358 px stack) less 12 px: the stack keeps 12 px at its end so a
  full-length book's ribbon and its pulled-out shift stay on the screen (08a lets GPT-3 run 6 px past the stack).
- **No frame for the sheet, the lamp-lit phone or 320 px.** The sheet uses DESIGN.md's phone sheet (14 px radius,
  e3 lift, a grip) and the card's own contents; at night only the room changes, as DESIGN.md §2 says of furniture.
- **At scale** (past 40 papers) the phone draws every book in its stack, as the desktop draws every spine (nothing
  is virtualised); 120 papers make a long scroll. Search, "need a look" and the Table do the finding (DESIGN.md §9).

## Remaining differences from 09a

09a is the desktop library at night, and S2h changes nothing at 1440 (above). Seen in `compare-09a-1440-dark.png`,
the base still differs from 09a in: no preview card over a focused spine (09a's "Attention Is All You Need ·
Reading now · p. 4 of 15" above the shelf; the card here opens only when a book is taken down); the groups stand
apart with a gap each, where 09a packs them; holders keep one line ("Generative models 2") where 09a breaks long
names onto two; "1 need a look" has no chevron. Typing "atten" (09a's second state) is `08a-search-390-light.png`
here at 390 and `S2d/01-atten-dark.png` at 1440. The lamp-lit phone (no frame) keeps the furniture as by day: the
cloths, gilt, kraft, walnut and the paper labels and holder cards (DESIGN.md §2).
