# S2e shots (#196): Reading now, the empty library, few papers, many papers

Taken at 1440 × 900 (one at 390 × 844) from the S2e branch against a copy of the v0.2 data, on its own
servers (web 18905, API 18906, the real worker). Accounts, all built through the API from the corpus PDFs:

- **01 (with the strip):** the fourteen corpus papers and one PDF that could not be read (15 papers, so spines);
  Attention (p. 4 of 15), DDPM (p. 9 of 25) and FlashAttention (p. 3 of 34) opened in that order, YOLO and ResNet
  finished, all through `PUT /papers/{id}/reading-state`.
- **01b:** a new, empty account.
- **01c:** Attention (p. 4 of 15), DDPM (p. 9 of 25) and YOLO (finished): frame 01c's three papers.
- **01f (120 papers):** the 15-paper account's own `GET /papers` rows, repeated under new ids to 120 by a
  Playwright route on that one request (the same papers uploaded again, in effect: real titles, authors, years
  and page counts; the account cannot hold the same PDF twice). Everything else is the real stack. With no
  topics yet (#193) "Topic" is one Unshelved row of 120; "Year" gives nine planks, closer to 01f's six topics.

`compare-*` put the frame (left, cropped to the 900 px fold) beside the built page (right), at half size.

| File | What |
| --- | --- |
| `01-strip-{light,dark}.png` | Reading now above the spines, most recent first |
| `01b-empty-{light,dark}.png` | the empty library: "No papers yet", the tabs, the accession slip on an empty plank |
| `01c-few-{light,dark}.png` | three papers face-out, with Continue / Read · Open under each |
| `01c-card-light.png` | keyboard: Tab to the shelf, → once, Enter: DDPM's catalogue card, focus on Read |
| `08a-strip-390-light.png` | the strip at phone width: stacked rows, 44 px Continue |
| `01f-topic-{light,dark}.png` | 120 papers by Topic: one plank, "26 of 120 shown · scroll sideways", "+94 more" |
| `01f-year-{light,dark}.png`, `01f-year-390-light.png` | 120 papers by Year: a plank per year, shorter spines |
| `01f-atten-light.png` | typing "atten": "16 of 120" in the field, and "13 matches here" on the bookend |
| `01f-more-light.png` | after Enter on "+94 more": the next spine has focus at the row's left, "+68 more" |
| `compare-01-strip-light.png`, `compare-01b-light.png`, `compare-01c-light.png` | frame beside build |
| `compare-01f-topic-light.png`, `compare-01f-year-light.png` | 01f beside build (Topic at the fold; Year whole) |

axe (wcag2a/aa, 21a/aa, 22aa, every rule including colour contrast) on the whole page, for the empty, few, demo
(4 papers) and 15-paper accounts and the 120-paper shelf (Topic and Year), at 1440 and 390, light and dark:
**0 violations of any impact** (22 runs). The first 120-paper run found `scrollable-region-focusable` (serious)
on rows without the tab stop; the "+n more" bookend now stands inside its scrolling row.

## Performance at scale (no virtualisation, ADR-004)

Production build (`next build`, `next start`), Chromium, 1440 × 900, the 400-paper list served as above; CDP
`ScriptDuration` deltas, three runs each. The machine was busy: **load average 54–80** during the 400 runs.

| | 400 spines | 120 spines |
| --- | --- | --- |
| render the list (from the `GET /papers` answer to the shelf painted) | 25–26 ms | 13–16 ms |
| a search keystroke ("a", "t", "t", "e", "n", then five Backspaces) | 2–8 ms (max 8) | 1–4 ms |
| re-arrange (Year, Title, Topic) | 14–31 ms | 4–11 ms |

A keystroke stays under 16 ms at 400 spines; the one-off render and a re-arrange (every spine remounts) do
not, at this load. In `next dev` (React's development build, load 12–20) a keystroke took 2–19 ms and the
render 30–43 ms.

## Deliberate deviations

- **A face-out shelf has no Reading now strip.** Frame 01c draws none (its covers carry Continue), so the strip
  stands above spines only. The brief's e2e said "Reading now shows it with p. 3" for a one-paper library; that
  paper stands face-out, so `e2e/v02/library-states.spec.ts` reads p. 3 and Continue from its cover's caption.
- **Continue writes the server's page into the reader's own place** (`papertree/reader/<paper_id>`, the
  documented contract in contracts.md §5) before it opens the reader. The reader restores only from that place,
  so without this a paper read on another device would open at the top. A place already on that page is kept,
  to the line.
- **Short titles in the strip** are the text before a colon, as on the spines ("FlashAttention"); a title with
  no colon is printed whole and truncated ("Denoising Diffusion Probabili…"), never an invented acronym
  (the frame's "DDPM").
- **The strip is not dimmed while a search runs** (frame 01's second state dims it): faded text would fall
  under 4.5:1, the same reason S2d leaves the title and view rows alone.
- **Covers keep the spines' gilt budget** (the diagonal sheen peaks at 5 %, the weave at 3 %), so their gilt is
  the tested 4.5:1 (`library-gilt.spec.ts`); the Language cloth and kraft take ink on a paper label.

## Remaining differences that are not this slice's

- No topics yet (#193): one "Unshelved" row, cloths from the arXiv-category fallback, no "6 topics", no topic
  line in a cover's caption, and 01b's footnote "Topics are suggested from each paper's arXiv category…" is left
  out because it would describe a feature that is not there yet.
- 15 papers, not 24; one corpus parse is titled "Abstract" (the A3C PDF), which is the parser's reading.
- The account initial comes from the email (no `display_name` in the auth store yet).

## Remaining visual differences

- 01: the spines stand on the left half of the plank (15, not 24, books); the strip and shelf match the frame's
  positions to within about 10 px.
- 01b: the slip stands about 50 px higher, and the plank spans the content width (80–1360 px) where the frame's
  runs 56–1384.
- 01f: the frame's six topic rows need topics (#193); by Year the rows are years and nine of them. The band the
  catalogue card opens into (136 px) stands between the strip and the first plank, so the first row starts
  about 100 px lower than 01f's. A spine at scale ends a long title in an ellipsis ("Attention I…"); the frame's
  96 "untitled" sample spines are blank. A few pixels of the spine under the "+n more" bookend show at the
  plank's right end.
- 01c: up to four covers stand on a plank at 1440 px (the frame shows three, spaced 376 px apart; three here are
  about 390 apart); the covers start about 20 px lower, because the band the catalogue card opens into is kept
  (56 px) and grows when a book comes down. A paper not started reads "Not started" and Open (01c shows only
  the Read and reading states).
