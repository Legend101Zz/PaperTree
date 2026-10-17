# S5e shots: Dive in, the tablet notebook (05b), the motion (11)

Slice S5e (#210), shot on 2026-10-17 against a `next dev` server of the slice's worktree (web 18900,
API 18907) on a copy of the v0.2 demo data, Playwright's Chromium, device scale 1, load average
35–48 (other agents running). The page is the Dive in of the stored answer of thread
`thr_01M508X9PC9K9HKHSVB2J9W1A1` (page `np_01M508X9PCVH6CHJJDJEGDTC7V`, the id derived from the
answer), with one typed note and one sticky added through the API and seven strokes drawn through
the tablet rail's pen with Playwright's mouse.

## The tablet, 1180 × 820 (frame 05b)

- `05b-notebook-tablet-1180-light.png`, `05b-notebook-tablet-1180-dark.png`: the pen in the hand.
- `05b-notebook-tablet-1180-vs-reference.png`: frame 05b beside the daylight shot.

What still differs from 05b:

- **No figure crop tool** in the rail (the frame's eighth tool): there is no crop in the notebook
  yet, and a control that does nothing is not drawn. **Redo** is in the rail under Undo (the frame
  shows Undo only); it is the same history S5d built.
- **The bar's title is the real page title**, which is long ("Dive in: We propose a new simple
  network architecture, the Transformer, based solely on…", the thread's title as S5a seeds it), so
  it ends in an ellipsis; the frame's shorter "Dive in: the Transformer's central proposal" is
  sample content.
- **The space between the coverage line and the cards** is S5a's seeded exchange box (320 page
  units) and S5c's layout, not this slice's; the frame packs the cards right under the line.
- **Ink sits under the cards** (S5d's layer order), so a stroke drawn across a card is hidden by
  it, and the handwriting is real strokes, not the frame's script face.
- **The side panel** (templates, counts, On the board) is not beside the page on a tablet; it
  follows the page down the desk, under it, so nothing it does is lost. The frame does not show it.
- **Pinch zoom** is not supported: the page's scale follows the width only (#292).
- **The rail's nib button** shows the nib letter under a dot, the colour button the ink's swatch;
  each opens a flyout beside the rail with S5d's three nibs or six colours.

## The Dive-in motion, 1440 × 900 (frame 11, "Dive in")

Captured with the motion tokens slowed ten times (`--pt-dur-quick` 1200 ms, `--pt-dur-open`
4800 ms, set on `:root` by the capture script only; the hooks read the tokens at run time), and the
mid-slide frame is the page's own Web Animations paused at half their duration.

- `motion-1-lift-{light,dark}.png`: Dive in pressed ("Opening the page…"); the exchange's call
  slip, AI slip and trace rows lifted 6 px with the e2 shadow, before the route changes.
- `motion-2-slide-{light,dark}.png`: half way: the page slides in from the right while the AI slip
  and the four trace rows (the cards that were on screen in the panel) travel to the AI slip and
  the quote cards 1–4 on the page. The call slip had scrolled out of the panel, so it rides in with
  the page.
- `motion-3-settled-{light,dark}.png`: settled.
- `motion-1-lift-light-reduced.png`, `motion-2-fade-light-reduced.png`,
  `motion-3-settled-light-reduced.png`: reduced motion: nothing lifts or travels; the notebook's
  desk replaces the reader with one `--pt-dur-quick` cross-fade (shot half way, after review: the
  bar and the panel never fade, so the header does not blink).

What still differs from frame 11:

- **The slips do not change size in flight.** The panel's AI slip holds the whole answer and the
  page's shows its first paragraph; paper is not stretched, so a card keeps the page's size and
  only its place travels (top-left corner to top-left corner).
- **The panel's cards stay in the panel during the slide** (the reader is gone once the route
  changes, so what travels are the page's own cards, starting where the panel's were).
- **Back** returns to the reader with the explain panel on the thread and the passage flashed; it
  has no reverse page turn ("Back turns the page the other way" is not built).
- **"then your pen is live"**: the pen is not put in the hand on arrival.

## Dive in on the phone sheet (08b, #293)

- `08b-pinned-dive-in-390-light.png`: the phone explain sheet (S4e) on the stored thread. The
  pinned footer carries "Dive in to answer 2" before "Send answer 2 to board", 44 px each; the
  first answer keeps its own Dive in and To board in the scroll, 44 px too. Still differing from
  08b: the thread has two answers, so both pinned buttons name answer 2 and "Send answer 2 to
  board" wraps to two lines at half the width.
