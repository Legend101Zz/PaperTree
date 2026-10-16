# S2g shots (#198): the Topics view (03)

Taken at 1440 × 900 and 390 × 844 (touch, full page) from the S2g branch, `next dev`, on S2g's own servers (web
18905, API 18906, the real worker) against a copy of the v0.2 data on the SSD. One account, built through the API:
the five corpus papers (Attention, BERT, DDPM, ResNet, YOLO). Two topics made with New topic's route
(`POST /topics`), the first paper of each chosen by hand (Attention, ResNet: "chosen by you"), the second accepting
the arXiv-category offer that then appeared (BERT, YOLO: "Suggested from arXiv cs.CL · you accepted"); DDPM (cs.LG)
left Unshelved, where it has no offer because no topic holds a cs.LG paper. Attention p. 4 and DDPM p. 9 opened,
YOLO finished (`PUT /papers/{id}/reading-state`).

**The demo library is small**: two topics of two papers each, against the frame's six topics and 24 papers, so the
grid has one row and the skylines are two spines wide.

| File | What |
| --- | --- |
| `03-topics-1440-{light,dark}.png` | the Topics tab: two cards, then Unshelved with DDPM and its topic picker |
| `03-topics-390-{light,dark}.png` | phone, full page: one column; the Unshelved row's picker wraps under its title |
| `03-topic-menu-1440-light.png` | a card's "…" open: the name, the six cloths by colour name, Save, Delete topic |
| `compare-03-light.png` | frame 03 (left) beside the build (right), half size |

axe (wcag2a/aa, 21a/aa, 22aa, every rule including colour contrast) on the whole page with the Topics tab open, with
a card's "…" menu open and with New topic open, at 1440 and 390, light and dark: **0 violations of any impact**
(12 runs). `document.documentElement.scrollWidth` equals the viewport at 390 and 1440.

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
