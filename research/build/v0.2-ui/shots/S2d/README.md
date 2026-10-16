# S2d shots (#195): the shelf beside frame 01

Taken at 1440 × 900 from the S2d branch against a copy of the v0.2 data. The 17-paper account was built from
the corpus PDFs: four reading, one finished, one queued (no worker running, so it stays kraft-wrapped) and
one that could not be read. `compare-01-*` put frame 01 (left) beside the built page (right).

| File | What |
| --- | --- |
| `01-shelf-{light,dark}.png` | the shelf, plain |
| `01-atten-{light,dark}.png` | typing "atten": 2 of 17 lit, nothing reordered |
| `01-card-light.png` | the catalogue card taken down from Attention Is All You Need |
| `01-demo-atten-light.png` | the demo account (4 papers) searching "atten": 1 of 4 |
| `compare-01-plain-light.png`, `compare-01-atten-light.png` | frame 01 beside the built page |

## Deliberate deviations from the mock-up

- **Gilt on cloth is lighter, and the light under a title is capped.** With the mock-up's sheen and weave
  under a title, gilt `#E0C98C` fell to about 3.6:1 on Vision and Reinforcement (4.5:1 is needed; titles are
  12–17 px, the year 11 px). The spine's gilt starts at `#EFE1B4`, the sheen peaks at 5 % and the weave's
  light threads at 3 %; `apps/web/test/library-gilt.spec.ts` recomputes every cloth's pair from the
  stylesheets (lowest: Reinforcement, about 4.7:1).
- **The dimmed shelf keeps paper labels readable.** A search veils non-matching cloth and fades the gilt to
  half (the frame's "dim to a third"), but a paper label's ink stays above 4.5:1, so the kraft, torn and
  Language labels stay brighter than the dimmed cloth. The title, stats and view row are not dimmed, which
  would put their text under 4.5:1.
- **The catalogue card carries Read, Retry and Delete**, so it is taller than the frame's info card, and it
  sits in the band's flow: a long title or the Delete confirmation moves the shelf down instead of covering
  the view row.
- **Spines are capped at 48 px** (DESIGN.md §9), so the frame's GPT-3 (90 px) and CLIP (67 px) would be 48.

## Differences that are not this slice's

- No Reading now strip (#196), so the shelf sits higher.
- No topics yet (#193): one "Unshelved" row and holder, cloths from the arXiv-category fallback, no topics in
  the stats line or the hint note.
- 17 papers (and 4 on the demo account), not 24.
- The account initial comes from the email; the auth store does not carry `display_name` yet.
- "Your library" is 56 px (DESIGN.md) where the mock-up HTML uses 64; "need a look" has no chevron or
  popover (it filters the shelf until the Table, #197).
