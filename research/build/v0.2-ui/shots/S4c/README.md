# S4c shots: the reader chrome and the selection toolbar (#203, #176, #177)

Taken 2026-10-16 with headless Chromium (Playwright 1.63, deviceScaleFactor 1) against the slice's own dev
server (web 18904 → API 18909 on a COPY of the demo data root), signed in as `demo@example.test`, on
"Attention Is All You Need" (`ppr_G9AYN750E5MG1NRBMGSQJ4N5JM`) at 125 %. The explain panel is open on the
REAL stored Thread 1 (S4b's frame-04 exchange). Compare with `../../reference/04-reader-explain-1440.png`
(1440 × 2240; these are its 900 px fold) and `../../reference/09b-reader-other.png`.

| File | What |
| --- | --- |
| `04-reader-selection-1440x900-light.png`, `-dark.png` | frame 04: the header, the desk, p. 2, "The Transformer allows … P100 GPUs." selected by mouse; the toolbar in the page's right margin, level with the selection's first line |
| `07a-toolbar-docked-1440x900-light.png`, `-dark.png` | the same selection at 150 %: the page is wider than the column, no margin fits, and the toolbar docks across the top of the column (frame 07a's form) |
| `contents-outline-1440x900-light.png`, `-dark.png` | Contents (#177): "Front matter → Attention Is All You Need", headings without numbers, no block types, no "Belongs to no section" |
| `highlight-card-by-mouse-1440x900-light.png`, `-dark.png` | #176: the card opened by a mouse click that moved 4 px between press and release (before, that press selected "o" and showed the toolbar instead) |
| `reader-selection-390x844-light.png`, `-dark.png` | the phone: the two-row header and the toolbar as a bottom bar (phone frames are S4e's) |

axe-core 4.12.1 in every state above, all in **Source** mode (selection with the panel open, Contents, the
highlight card, the phone selection and Contents), 1440 and 390, light and dark: **0 serious or critical**.
Moderate only: `region` on pdf.js's own `.hiddenCanvasElement`, and `landmark-unique` on S4b's AI-slip sections
(with the phone sheet open, also the `Sheet`'s own banner). Not covered: in Split and Guided, axe reports one
serious `scrollable-region-focusable` on Guided's horizontally scrolling math blocks (`GuidedView`, unchanged
by this slice; review N16).

## What matches frame 04

The 56 px ivory header across the full width with the explain drawer under it: Library, Contents, a rule, the
title in Libre Caslon Text bold, "p. 2 of 15" in Courier Prime, Source · Guided · Split, − / zoom select in
Courier / +, Board with its icon, Explain as a tab (AI-slip fill, oxblood underline) while the panel is open.
The reader desk (`--pt-desk` with the laid pattern), the PDF page as a sheet with e1, the selection in the
blue-grey wash, the toolbar as a column in the page margin beside the selection: Explain (bold, first),
Ask, Highlight, the five washes, Send to board. Lamp-lit: the dark desk, the PDF page dimmed to `#E9E1D1`
(the paper stays paper), the bar on e2 fill.

## Remaining differences, and why

1. **The toolbar is 130 px wide, the design's 106.** Each wash is an 18 px chip inside a 24 px target (WCAG
   2.5.8's minimum; 40 px on the phone's bar); the design's 14 px dots are under the minimum target. Items are
   40 px tall (34 in the mock), v0.1's floor.
2. **Copy stays** at the end of the toolbar: a v0.1 behaviour the e2e suite checks; the design has no Copy.
3. **Icons are lucide's** (message, T, highlighter, pin, copy, workflow, align-left, arrow) at stroke 1.5, close
   to the design's glyphs but not its exact paths.
4. **Header control heights**: the mode switch's radios are 44 px (`SegmentedControl`'s touch minimum) where
   the mock draws 30 px buttons in a 36 px group; the zoom select is 40 px (the RFIX2 screens e2e holds every
   header control to 40) where the mock draws 32; − and + are the v0.1 text glyphs.
5. **Library has an arrow, not the sprout**, as the slice brief says (the sprout stays on the library's bar).
6. **"Contents 1"** keeps v0.1's highlight count beside the word; the mock has none.
7. **No citation flash or "from marker 2" tab in the selection shot**: the flash clears on the reader's next
   action, so a new selection ends it. Both are S4b's and are in `../S4b/`.
8. **The explain panel's own differences** ("Summarize paper", the "D" stamp, the composer) are S4b/S4d's;
   see `../S4b/README.md`.
9. **The page is 765 px (125 %)** in an 800 px column; the mock's page is 736 px with 32 px of desk each side.
   "Fit width" gives about 752 px.
10. **The PDF is pdf.js's real rendering**; the mock sets the page in Tinos.
11. **The selection wash is 24 % navy** where the mock uses 22 %, to read on the dimmed lamp-lit page too.
12. **Phone**: the toolbar bar wraps to three rows (40 px washes) and the header is v0.1's two-row bar
    restyled, Contents drawn as its icon below 1100 px; frames 08b and 09b's phone reader are S4e's (#205).
13. **Not in the design, added for the review:** when no margin is wide enough the toolbar docks at the top of
    the column, and at the bottom when the selection sits under the top band (so it never covers the selected
    lines); "Explain with a diagram" is drawn only once the diagram slice wires it.
14. **The washes read slightly weaker by lamplight**: amber measures 1.10:1 against the dimmed page against
    1.18:1 by day (review N7). The ink underline keeps every highlight visible; the overlay-colour pass the audit
    asks for (GAP-A2 risk 9) is left to S4e's lamp-lit page.
15. **No reserved AI marker on Explain and Ask** (v0.1's Ask carried it): frame 04 draws none, and the answer
    itself is marked as the AI's (the slip, its "AI" tab). For the owner: the v0.1 rule "the bar says so before
    the reader presses it" is dropped with the design (review N15).
16. **Wording**: the toolbar's "Send to board" and its toast ("Passage added to your board", "Open board")
    agree; the explain panel's "Send to canvas" and its toast keep "canvas" until the Canvas → Board sweep (S6d).
