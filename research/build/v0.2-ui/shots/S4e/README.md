# S4e shots: the phone reader (08b) and the lamp-lit reader (09b) (#205)

Taken 2026-10-17 (re-taken after the review fixes) with headless Chromium (Playwright 1.63, deviceScaleFactor 1) against the slice's own stack (web
18908 → API 18900 on a COPY of the demo data root → the agent on 18903, faux except for the one live smoke), signed
in as `demo@example.test`, on "Attention Is All You Need" and its real stored thread `thr_01M508X9PC9K9HKHSVB2J9W1A1`
(frame 04's, "Thread 1" in the menu; the copy holds more threads than the frame's two). The live run is recorded in
[`live-smoke.md`](live-smoke.md).

| File | Frame | What |
| --- | --- | --- |
| `08b-phone-reader-390x844-{light,dark}.png` | 08b | the one-row header (back, title, "p. 1", Explain, the menu), the sheet over a peek of the page, its header "Explain · Thread 1 of 6 ⌄ · Summary · ×", the call slip (quote on two lines, its tab), the answer's first paragraph with marker 1 (22 px) and "Read the whole answer", the pinned footer |
| `08b-phone-trace-390x844-{light,dark}.png` | 08b | the same, scrolled to the coverage line and the trace as 44 px rows (number, tab, where, two-line quote, chevron) |
| `08b-phone-menu-390x844-{light,dark}.png` | 08b | the header's menu: Contents (1 highlight), Source · Guided · Split, zoom, Board |
| `08b-phone-menu-over-sheet-390x700-light.png` | 08b | the menu opened with the explain sheet up: drawn above it, every item answers taps where it is drawn |
| `08b-phone-inset-flash-390x700-light.png` | 08b | 390 × 700: trace row 2 tapped; its passage sat behind the peek sheet, so the reader scrolled it up before flashing |
| `08b-phone-sheet-667x375-light.png` | 08b | a landscape phone: the sheet full height under the header, the pinned footer on one line, the follow-up box on screen |
| `08b-phone-reader-320x568-light.png` | 08b | the sheet at 320 × 568 |
| `08b-phone-marker2-flash-390x844-{light,dark}.png` | 08b | faux: after select → Explain, marker 2 tapped: the sheet at peek and passage 2 flashed above it, its margin tab beside it |
| `08b-phone-whole-390x844-{light,dark}.png` | 08b | faux: a three-paragraph follow-up (`[faux:paragraphs]`) after "Read the whole answer": all paragraphs, the run "[1, 2]" in the second, the uncited one under "no citation · the AI's own reading", Show less |
| `08b-live-explain-390x844-light.png`, `08b-live-marker-flash-390x844-light.png` | 08b | the live run (M3.1 Flash): the answer as it settled, and marker 1's flash |
| `08b-guided-390x844-dark.png` | 08b | Guided at 390: no floating "Ask AI" over the text (S4c removed it) |
| `09b-reader-1440x900-dark.png` | 09b | lamp-lit: walnut chrome, the dimmed PDF page (multiply onto `--pt-pdf-page`), the call slip with the typed ask in blue Courier, the AI slip on dark brown, gold tabs |
| `09b-flash-1440x900-dark.png`, `09b-linger-1440x900-dark.png` | 09b | Show in paper on passage 2: the flash ring in daylight navy on the dimmed page, the wash, the margin tab; then the outline that stays |

**axe-core 4.12.1** over the whole page (colour contrast on), 18 runs after the review fixes: the sheet, the sheet's
flow (select → Explain → marker 2 → the follow-up → Read the whole answer), the menu and Guided at 390 × 844 and at
320 × 568, and the reader with the drawer and a flash at 1440 × 900, each light and dark: **0 serious or critical**.
The first run found one serious rule on Guided at 390, `scrollable-region-focusable` on a table wider than the phone;
a table that scrolls sideways is now a named region and a tab stop, and one that fits is neither (Attention: 2 of 6
scroll at 390, 1 at 1440). Moderate rules left: duplicate banner/landmark names, pdf.js's hidden canvas outside a
region.

## Measured

- **Targets at 390:** an inline marker is a 22 × 22 px square; a tap 21 px from its centre in each of the four
  directions lands on it (a 44 px target). Trace rows are 82 px tall (≥ 44). The sheet's scroll ends at y 702 and the
  pinned footer starts at 702: the footer never covers the answer. The quote is two lines. Back, Explain and the menu
  button are 44 px tall at 390 and 320 (Explain was 40); the menu's zoom steps are 44 × 44.
- **A run "[1, 4]" (the golden thread's second answer):** each marker's square is a layer above every tap area and
  the two areas meet halfway across the 2 px gap. 121 of 121 grid points on each square answer to it (before: 55 of
  121 on marker 1 flashed passage 4); on the line through both, one handover, in the gap.
- **Behind the peek sheet (390 × 700 and 664):** every trace row of the golden thread now flashes above the sheet (row
  2 was at y 622–669 under a sheet top of 580); the reader counts the peek's 120 px as out of view.
- **Landscape:** 667 × 375 leaves 118 px of answer (was 32) and the follow-up box ends at 375; 740 × 360, 103 px.
- **Focus:** Contents from the menu lands on the Contents panel's tab and returns to the menu button on Esc (it fell
  to `<body>`); the menu closes when focus leaves it.
- **Zoom restore at 390 (#175, NOT CONFIRMED in the audit): works, no fix needed.** Fit width (page 343 px) →
  150 % from the menu → scrolled 900 px → reload: the select says 150 %, the page is 918 px wide before and after, the
  scroll is back at 900 px. `e2e/v02/phone-reader.spec.ts` keeps it.
- **The dimmed page, from the tokens** (`packages/ui/test/tokens.spec.ts`): PDF type on `#E9E1D1` 16.2:1; the flash
  ring was the lamp-lit focus blue `#8FB8E8` at **1.6:1** on the dimmed page and is now `--pt-pdf-ring` `#1F4E79`
  (6.7:1; 6.3:1 on the lit wash); the outline a flash leaves (`linger`) 3.5:1 at opacity 0.7 (0.35 would be 1.8:1);
  the outline by day is now 0.6 (3.1:1 on white; it was 0.35, 1.8:1), since on a phone it is the only lasting cue;
  the five underline inks 3.6–5.5:1; each wash on the PDF raised (amber 56 %, the rest 45 %) so it stands off the
  ivory at least as far as off white by day (amber 1.18 vs 1.18, green 1.27 vs 1.24, blue 1.34 vs 1.29, pink 1.32 vs
  1.28, purple 1.41 vs 1.33), black type on every wash ≥ 11.4:1; under the selection 11.1:1. Guided's dark page keeps
  the plain washes (its light ink needs them).
- **Scroll cost of the multiply blend at 300 %** (1440 × 900, 180 scripted scroll steps of 30 px, one per frame, two
  runs per scheme, load average 13–14): frame interval mean 16.5 ms in both schemes; p95 18.0–18.2 ms by day, 18.3–18.6
  ms lamp-lit; at most one frame over 20 ms per run in both (max 22–29 ms lamp-lit, 18–23 ms by day). No cost the
  60 Hz cadence shows. Headless Chromium; a GPU's compositor was not measured.

## Remaining differences, and why

Against 08b:

1. **The header keeps "Explain"** between "p. 1" and the menu (the frame has none): it is the reader's only way to
   open the panel (S4c) and focus returns to it; the title therefore truncates earlier ("Attention Is All You N…").
2. **The sheet's header has "Summary"**: without it the summary has no way in on a phone.
3. **The pinned footer has its board button only.** Dive in from the explain panel is S5e's (#210: explain →
   notebook, with its motion); the API and the notebook page exist, but nothing wires the button yet on any surface.
   Diagram: #217's plate starts from the selection toolbar ("Explain with a diagram"); no surface offers it under an
   answer yet (04's "Explain with a diagram" is not wired on desktop either). Neither is drawn dead. A plate in the
   thread keeps its own actions; only answers are pinned.
4. **The thread is the real one, with two exchanges:** the first keeps its own usage line and To board in the scroll;
   only the last answer's are pinned, and the pinned button then says which it sends ("Send answer 2 to board"). The
   menu says "Thread 1 of 6".
5. **Trace rows keep "where · cited n×"** beside the tab, and the chevron is a "›" glyph.
6. **The call slip keeps its time** beside the tab; **"Read the whole answer" turns into Show less** once open.
7. **The flash's margin tab** ("from marker 2 in the answer", S4b) has no margin on a phone: off-screen, or over an
   indented passage's first lines, while the flash runs. Filed as #279.
8. **A passage already in view flashes while the sheet is still lowering** (240 ms; the live run's marker 1). A
   passage behind the peek sheet now scrolls up first (fixed in the review round).
9. **Landscape phones get the sheet full height under the header** (no frame draws them), with the pinned footer on
   one line: 118 px of answer at 667 × 375.

Against 09b:

1. **"Summarize paper"** (S4b's words) instead of "Summary"; zoom at 125 % (the saved state) instead of Fit width.
2. **The usage line has no "first text after 2.4 s"** (S4b's line; the data is on the wire).
3. **The selection toolbar is not in these shots** (S4c's shots have it, both schemes).
4. **The highlight wash on the PDF is amber at 56 %** (the frame draws 55 %): 55 % stood off the ivory a hair less
   than 30 % does off white.
