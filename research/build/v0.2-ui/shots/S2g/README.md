# S2g shots (#198): the Topics view (03) and the Map (01e)

Taken at 1440 × 900 and 390 × 844 (touch, full page) from the S2g branch, `next dev`, on S2g's own servers (web
18905, API 18906, the real worker) against a copy of the v0.2 data on the SSD. One account, built through the API:
the five corpus papers (Attention, BERT, DDPM, ResNet, YOLO). Two topics made with New topic's route
(`POST /topics`), the first paper of each chosen by hand (Attention, ResNet: "chosen by you"), the second accepting
the arXiv-category offer that then appeared (BERT, YOLO: "Suggested from arXiv cs.CL · you accepted"); DDPM (cs.LG)
left Unshelved, where it has no offer because no topic holds a cs.LG paper. Attention p. 4 and DDPM p. 9 opened,
YOLO finished (`PUT /papers/{id}/reading-state`).

**The demo library is small**: two topics of two papers each, against the frame's six topics and 24 papers, so the
grid has one row, the skylines are two spines wide, and the Map has three islands with two papers at most.

The Map's three links are the real ones `GET /library/links` finds in this account, all by title: DDPM → Attention,
BERT → Attention, Attention → ResNet (GAP-A1's citation table lists the same three for these five papers).

| File | What |
| --- | --- |
| `03-topics-1440-{light,dark}.png` | the Topics tab: two cards, then Unshelved with DDPM and its topic picker |
| `03-topics-390-{light,dark}.png` | phone, full page: one column; the Unshelved row's picker wraps under its title |
| `03-topic-menu-1440-light.png` | a card's "…" open: the name, the six cloths by colour name, Save, Delete topic |
| `compare-03-light.png` | frame 03 (left) beside the build (right), half size |
| `01e-map-1440-{light,dark}.png` | the Map tab: the legend, two topic islands and the dashed Unshelved, the three links with their tags |
| `01e-map-list-1440-{light,dark}.png` | full page, "The plan as a list" open: topics, papers (links to the reader), the three links in words |
| `01e-map-390-{light,dark}.png` | phone, full page: one island to a row; the links run in the left lane, their tags off every paper |
| `01e-map-14papers-1440-light.png`, `01e-map-14papers-390-light.png` | after review: every corpus and fresh PDF (14), 12 topics (one with a 60-character name, cut with "…"; five empty), the 15 real links; 12 tags at 1440 and 11 at 390 find a free place, the rest are labelled in the list only and the legend says so |
| `03-topics-12topics-1440-light.png` | after review: the same account's Topics, "12 topics" in the title (empty topics counted) |
| `compare-01e-light.png` | frame 01e (left) beside the build (right), half size |
| `e2e-map-live-parse-1440.png` | the e2e's last shot (`e2e/v02/library-topics-map.spec.ts`), taken while YOLO and DDPM were still being read: kraft spines, "· being read", two links so far |

axe (wcag2a/aa, 21a/aa, 22aa, every rule including colour contrast) on the whole page: the Topics tab, with a card's
"…" menu open and with New topic open; the Map tab, and with its list open; at 1440 and 390, light and dark:
**0 violations of any impact** (20 runs, from the Map branch; the Topics branch alone had 12 of its own, also 0).
After the review the shots were retaken and axe run again on both accounts (the 5-paper one and the 14-paper one):
0 violations in 40 runs on the Map branch, and 24 on the Topics branch. The first run on the 14-paper account
found the list's paper links 18 px tall (`target-size`); they are 24 px now.
`document.documentElement.scrollWidth` equals the viewport at 390 and 1440 in every view.

The e2e `e2e/v02/library-topics-map.spec.ts` was run against these servers with a scratch Playwright config (no
`pnpm e2e`, no servers of its own, a fresh account): **1 passed** (31 s).

## Remaining differences against 03

- **No plate figure on any banner.** Frame 03's first card shows "The paper's own Figure 1, from Attention, p. 3".
  The plate is S3's (#200) and does not exist on this base, so every banner is the topic's cloth with its pattern,
  the gilt frame and the ornament; none is blank. The frame draws the ornament only on two cloths; here it is on
  every banner, because without a figure the ornament is what keeps a banner from being empty (#198's "a topic
  with no figure gets the ornament").
- **A "…" menu on each card** (top right of the banner) and **New topic** at the right of the view row: the frame
  draws neither, but #198 asks for rename, recolour, delete and create.
- **Unshelved** is a card under the grid that the frame does not draw (no paper in the frame is unshelved).
- **The source line counts hand-shelved papers** ("· 1 chosen by you"): in this account the first paper of each
  topic was chosen by hand, which is the only way a person's first paper reaches a topic (S2b's rule offers only a
  topic that already holds a paper of the same arXiv category; the model half is #242).
- **The third stat** follows the frame's examples ("2 reading now", "3 read", "1 could not read", "not started"),
  picking the most pressing state; the frame never shows two states at once and neither does the build.
- The frame's focused card (navy ring) is the keyboard focus here too (the ring is drawn around the whole card).

## Remaining differences against 01e

- **Citation links are drawn**, dotted (the "references" thread of DESIGN.md §5, so colour is not the only cue) with
  an arrowhead at the cited paper and a two-line paper tag "cites it / matched by title". The frame draws no line
  because its only link source was a board; boards hold one paper (S2c), so its "Papers you linked on a board"
  says "none yet" here too, and a second legend line counts the citation links ("· 3", "none yet" when there are
  none). The frame's note ("A line between two papers appears only when you link them on a board") is reworded to
  what is true now.
- **Unshelved is a dashed island** (not hatched: no one accepted it); the frame has no unshelved paper.
- **Islands sit in a grid** (three to a row at 1440, the legend above them) instead of the frame's hand-placed
  layout beside the legend: the layout is pure and deterministic, and a cell depends only on its index and its own
  papers, so papers arriving in one topic never move another. Long titles are cut with "…" (the full title is in
  the SVG `<title>` and the list); the frame wraps one onto two lines.
- **Papers on the plan are not buttons.** The frame shows a focused token; here the plan is one named picture and its
  keyboard path is "The plan as a list" after it, where every paper is a link to the reader. The search rings and
  dims tokens as the frame's focus ring does.
- At 390 the plan is one column; the frame has no phone Map.

## After the review (#198 should-fix items)

- An open "…" panel stands above every other card (`elementFromPoint` at the next card's "…" centre returns the
  panel, 1440 and 390, the review's `p10-stack` probe on this build).
- The title counts every topic (`03-topics-12topics-1440-light.png`: "12 topics" over 12 cards, 5 of them empty).
- Enter in the search on Topics or the Map acts on that view (a lit card's name; the Map's list, opened at the
  match) and opens no catalogue card on the hidden shelf.
- While `GET /library/links` loads, the plan's name says "citation links still loading" and the legend "· loading";
  a failed read (after one retry) says "could not be read" in the name, the legend and the list, with an alert and
  Try again. A failed `GET /topics` read is an alert with Try again ("a topic with no papers is missing from the
  plan"), never "No topics yet" (the review's `p8b` probe, and a variant failing `/topics` from the first load).
- Cartouches are at most their cell's width and on the plan; the 60-character name is cut with "…" and whole in the
  cartouche's `<title>` and the list.
- Link tags are placed along their curve where they cover no paper, cartouche or other tag (the review's `p5b`
  probe: 12 tags at 1440 and 11 at 390, 0 overlaps); the links without a free place are labelled in the list only.
