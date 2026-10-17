# S3 shots (#200): the pulled-out and opened book

Taken at 1440 × 900 and 390 × 844 from the `v02/s3-book` branch, `next dev`, against a copy of the v0.2 data on
S3's own servers (web 18904, API 18909, no worker, no agent). The demo account's four papers (Attention, DDPM,
ResNet, YOLO), so the shelf stands face-out (01c) and the book on it is a cover. Set through the API first, as a
person would: Attention under a topic "Transformers & attention" (chosen by hand, so "chosen by you"), and opened
at p. 4. The display name was empty, so the plate asked; "Mrigesh" was typed into "Whose library is this?" and
saved through the page (`02-open-named`). The figures, captions, abstract and counts are the parse's and the
database's own (Attention has 1 highlight and 6 explanation threads in this data, no notebook page).

| File | What |
| --- | --- |
| `02a-pulled-1440-{light,dark}.png` | Enter on the cover: the book out, turned face-out, the slot a shadowed gap, the slip |
| `02a-pulled-plate-1440-light.png` | the same once Figure 1 is the plate (02a's variant) |
| `02-open-1440-{light,dark}.png` | Enter again: the spread, the bookplate asking "Whose library is this?" |
| `02-open-named-1440-light.png` | after the name was saved: "From the library of Mrigesh" |
| `02-open-plate-1440-light.png` | after "Use Figure 1 (p. 3) as the plate": the figure and its caption on the left |
| `shelf-plate-cover-1440-light.png` | Esc: back on the shelf, focus on the book, its cover now carrying the plate |
| `02a-pulled-390-light.png`, `02-open-390-{light,dark}.png`, `02-open-390-light-end.png` | phone: the spread stacked, the dialog scrolled to its end |
| `reader-abstract-flash-1440.png` | the "p. 1 · Abstract" tab followed: the reader flashes the abstract |
| `compare-02a-light.png`, `compare-02-light.png` | frame (left) beside the build (right), half size |

Re-taken after the review (the figures line, the summary's words, the header's initial). axe (every rule) on the whole page with the book open, pulled out and open, at 1440 and 390, light and dark, plus
the open book with the plate at 1440 light: **0 serious or critical violations in 9 runs, and none of any
impact**. The first run found two in the lamp-lit spread (the name field's label and "Not now" on the bookplate
took the dark scheme's ink on the plate's paper); the bookplate now carries daylight's ink tokens, because it stays
paper in both schemes. Focus: on the cover when it comes out ("Open Attention Is All You Need"), on Read when it
opens, back on the book after Esc. Reduced motion (`reducedMotion: 'reduce'`): `data-motion="reduced"`.

## Remaining differences against 02a and 02

- **02a draws two books** (the default and the plate variant, with blue annotation tags) to show both; the build
  pulls out one, centred above the shelf. The frame's veil also blurs the page more strongly than `backdrop-filter:
  blur(1.5px)` does.
- **Topic source**: the frame says "suggested from arXiv cs.CL · you accepted"; here the topic was chosen by hand
  (no other cs.CL paper held it, so there was nothing to suggest), and the book says "chosen by you", from the
  field. The suggested wording is unit-tested.
- **Counts**: the frame's "3 highlights · 2 explanation threads · 1 notebook" is sample content; the build prints
  the row's real counts ("1 highlight · 6 explanation threads") and says "notebook page(s)", the unit
  `notebook_count` counts.
- **Figures line**: "5 figures found · Figure 1 (p. 3), Figure 2 (p. 4)" where the frame says "5 figures ·
  found …": the number is what the parser found, not the paper's count (after review: ResNet has 7 figures and
  3 are found, #103).
- **Summary's words** come from the summary route since the review ("Summary ready (cached)" here: Attention's
  stored summary is complete; a partial one says "Summary cached (partial: …)").
- **Read** carries the arrow; the frame's 48 px Read and Summary are 48 and 44 px here (Summary uses the touch
  size). The abstract's opening quotation mark hangs by `text-indent`, a little less than the frame's.
- **The account initial**: since the review it is the library's name once one is saved ("M" in
  `shelf-plate-cover`), else the email's ("D" in the first shots, before the name was saved).
- **Phone**: no frame draws the opened book at 390; the build stacks the two pages in a scrolling dialog.
